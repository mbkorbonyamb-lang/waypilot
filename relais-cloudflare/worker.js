/*
 * Relais WayPilot pour l'audit express (Cloudflare Worker).
 * WooCommerce n'autorise sa Store API que depuis le site de la boutique (CORS) : ce relais la lit
 * à la place du navigateur. Il ne reçoit aucune clé, ne garde rien et ne journalise pas les contenus.
 * Même contrat que relais/app.py : GET /products?site=<hôte>&page&per_page&include&type.
 * Shopify : GET /shopify?site=<hôte>&page lit le catalogue public /products.json (250 produits par page).
 * Rapports en ligne (stockage KV « RAPPORTS ») : POST /rapports publie un rapport (code d'accès WayPilot exigé),
 * GET /r/<id> l'affiche et compte les ouvertures, POST /rapports/suivi liste les rapports et leurs ouvertures.
 */
const HOST_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const ALLOWED = {
  page: /^\d{1,4}$/,
  per_page: /^(100|[1-9]\d?)$/,
  include: /^\d{1,12}(,\d{1,12}){0,99}$/,
  type: /^(simple|variable|variation|grouped|external)$/
};
const MAX_BYTES = 8 * 1024 * 1024;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-WP-TotalPages" };
const REPORT_MAX_BYTES = 2 * 1024 * 1024;
const REPORT_TTL = 90 * 24 * 3600; // un rapport en ligne expire au bout de 90 jours
const REPORT_ID_RE = /^[A-Za-z0-9]{12}$/;
// Le rapport est du HTML produit par WayPilot : aucun script autorisé, pas d'indexation.
const REPORT_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store"
};

const json = (status, data, extra = {}) => new Response(typeof data === "string" ? data : JSON.stringify(data), {
  status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }
});

export function cleanHost(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (!HOST_RE.test(s)) throw new Error("Adresse de boutique invalide.");
  return s;
}

export function storeUrls(host, query) {
  const params = new URLSearchParams(query).toString();
  return [
    `https://${host}/wp-json/wc/store/v1/products?${params}`,
    // Permaliens « simples » : /wp-json/ n'existe pas, rest_route fonctionne.
    `https://${host}/?rest_route=%2Fwc%2Fstore%2Fv1%2Fproducts&${params}`
  ];
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function newId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(12))].map(b => chars[b % chars.length]).join("");
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > REPORT_MAX_BYTES + 4096) throw new Error("Rapport trop volumineux.");
  return JSON.parse(text);
}

// Seul le détenteur du code d'accès WayPilot peut publier ou lister : sinon n'importe qui pourrait héberger des pages ici.
async function authorized(body, env) {
  return Boolean(env.ACCESS_HASH) && typeof body.code === "string" && (await sha256(body.code.trim().toUpperCase())) === env.ACCESS_HASH;
}

async function reports(request, url, env) {
  if (!env.RAPPORTS) return json(503, { message: "Stockage des rapports non configuré." });
  if (request.method === "GET" && url.pathname.startsWith("/r/")) {
    const id = url.pathname.slice(3);
    if (!REPORT_ID_RE.test(id)) return new Response("Rapport introuvable.", { status: 404, headers: REPORT_HEADERS });
    const html = await env.RAPPORTS.get(`r:${id}`);
    if (html === null) return new Response("Rapport introuvable ou expiré.", { status: 404, headers: REPORT_HEADERS });
    const views = JSON.parse((await env.RAPPORTS.get(`v:${id}`)) || "{}");
    const now = new Date().toISOString();
    await env.RAPPORTS.put(`v:${id}`, JSON.stringify({ count: (views.count || 0) + 1, first: views.first || now, last: now }), { expirationTtl: REPORT_TTL });
    return new Response(html, { status: 200, headers: REPORT_HEADERS });
  }
  if (request.method !== "POST") return json(405, { message: "Méthode non autorisée." });
  let body;
  try { body = await readJson(request); } catch (e) { return json(400, { message: e.message.startsWith("Rapport") ? e.message : "Requête illisible." }); }
  if (!(await authorized(body, env))) return json(403, { message: "Code d'accès refusé." });
  if (url.pathname === "/rapports") {
    if (typeof body.html !== "string" || !body.html.startsWith("<!doctype html>")) return json(400, { message: "Rapport invalide." });
    if (new TextEncoder().encode(body.html).length > REPORT_MAX_BYTES) return json(413, { message: "Rapport trop volumineux." });
    const id = newId();
    const store = String(body.boutique || "").slice(0, 120);
    await env.RAPPORTS.put(`r:${id}`, body.html, { expirationTtl: REPORT_TTL, metadata: { store, created: new Date().toISOString() } });
    return json(201, { id, url: `${url.origin}/r/${id}` });
  }
  if (url.pathname === "/rapports/suivi") {
    const list = await env.RAPPORTS.list({ prefix: "r:", limit: 1000 });
    const rows = await Promise.all(list.keys.map(async k => {
      const id = k.name.slice(2);
      const views = JSON.parse((await env.RAPPORTS.get(`v:${id}`)) || "{}");
      return { id, url: `${url.origin}/r/${id}`, store: (k.metadata || {}).store || "", created: (k.metadata || {}).created || "", views: views.count || 0, firstView: views.first || "", lastView: views.last || "" };
    }));
    rows.sort((a, b) => b.created.localeCompare(a.created));
    return json(200, rows);
  }
  return json(404, { message: "Chemin inconnu." });
}

export async function handle(request, fetchImpl = fetch, env = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" } });
  const url = new URL(request.url);
  if (url.pathname.startsWith("/r/") || url.pathname.startsWith("/rapports")) return reports(request, url, env);
  if (request.method !== "GET") return json(405, { message: "Méthode non autorisée." });
  if (url.pathname === "/" || url.pathname === "/sante") return json(200, { ok: true });
  if (url.pathname === "/shopify") return shopify(url, fetchImpl);
  if (url.pathname !== "/products") return json(404, { message: "Chemin inconnu." });
  let host;
  try { host = cleanHost(url.searchParams.get("site")); } catch (e) { return json(400, { message: e.message }); }
  const query = {};
  for (const [k, re] of Object.entries(ALLOWED)) {
    const v = url.searchParams.get(k);
    if (v !== null && re.test(v)) query[k] = v;
  }
  if (!query.per_page) query.per_page = "100";
  let last = [502, "La boutique n'a pas répondu."];
  for (const target of storeUrls(host, query)) {
    let res;
    try {
      res = await fetchImpl(target, { headers: { Accept: "application/json", "User-Agent": "WayPilot-audit/1.0" }, redirect: "follow" });
    } catch (_) { return json(502, { message: "La boutique n'a pas répondu." }); }
    if (!new URL(res.url || target).protocol.startsWith("https")) return json(502, { message: "Redirection refusée." });
    const body = await res.text();
    if (body.length > MAX_BYTES) return json(502, { message: "Réponse trop volumineuse." });
    if (!res.ok) {
      last = [[401, 403, 404, 429].includes(res.status) ? res.status : 502, `La boutique a répondu ${res.status}.`];
      if (res.status === 404) continue;
      break;
    }
    try { JSON.parse(body); } catch (_) { last = [502, "Réponse inattendue de la boutique (pas du JSON)."]; continue; }
    const total = res.headers.get("X-WP-TotalPages");
    return json(200, body, total ? { "X-WP-TotalPages": total } : {});
  }
  return json(last[0], { message: last[1] });
}

// Shopify publie son catalogue en JSON (/products.json), sans clé : produits publiés, variantes, images.
async function shopify(url, fetchImpl) {
  let host;
  try { host = cleanHost(url.searchParams.get("site")); } catch (e) { return json(400, { message: e.message }); }
  const page = ALLOWED.page.test(url.searchParams.get("page") || "") ? url.searchParams.get("page") : "1";
  let res;
  try {
    res = await fetchImpl(`https://${host}/products.json?limit=250&page=${page}`, { headers: { Accept: "application/json", "User-Agent": "WayPilot-audit/1.0" }, redirect: "follow" });
  } catch (_) { return json(502, { message: "La boutique n'a pas répondu." }); }
  if (!new URL(res.url || "https://x").protocol.startsWith("https")) return json(502, { message: "Redirection refusée." });
  const body = await res.text();
  if (body.length > MAX_BYTES) return json(502, { message: "Réponse trop volumineuse." });
  if (!res.ok) return json([401, 403, 404, 429].includes(res.status) ? res.status : 502, { message: `La boutique a répondu ${res.status}.` });
  let data;
  try { data = JSON.parse(body); } catch (_) { return json(404, { message: "Catalogue Shopify introuvable à cette adresse." }); }
  if (!data || !Array.isArray(data.products)) return json(404, { message: "Catalogue Shopify introuvable à cette adresse." });
  return json(200, body);
}

export default { fetch: (request, env) => handle(request, fetch, env) };

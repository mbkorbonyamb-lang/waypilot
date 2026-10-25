/*
 * Relais WayPilot pour l'audit express (Cloudflare Worker).
 * WooCommerce n'autorise sa Store API que depuis le site de la boutique (CORS) : ce relais la lit
 * à la place du navigateur. Il ne reçoit aucune clé, ne garde rien et ne journalise pas les contenus.
 * Même contrat que relais/app.py : GET /products?site=<hôte>&page&per_page&include&type.
 * Shopify : GET /shopify?site=<hôte>&page lit le catalogue public /products.json (250 produits par page).
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

export async function handle(request, fetchImpl = fetch) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
  if (request.method !== "GET") return json(405, { message: "Méthode non autorisée." });
  const url = new URL(request.url);
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

export default { fetch: request => handle(request) };

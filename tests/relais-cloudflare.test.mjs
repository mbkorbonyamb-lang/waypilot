// Lancer avec : node --test tests/relais-cloudflare.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handle, cleanHost } from "../relais-cloudflare/worker.js";

const ok = (body, total) => ({ ok: true, status: 200, url: "https://jaaray.site/x", text: async () => body, headers: new Headers(total ? { "X-WP-TotalPages": total } : {}) });

test("adresses refusées et nettoyées", () => {
  for (const bad of ["localhost", "127.0.0.1", "a b.com", "shop.test:8080", ""]) assert.throws(() => cleanHost(bad));
  assert.equal(cleanHost("https://www.JAARAY.site/boutique"), "www.jaaray.site");
});

test("paramètres filtrés, CORS et pagination exposés", async () => {
  const seen = [];
  const res = await handle(new Request("https://relais.test/products?site=jaaray.site&page=2&include=1,2&type=variation&consumer_key=x"), async url => { seen.push(url); return ok('[{"id":1}]', "3"); });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("X-WP-TotalPages"), "3");
  assert.deepEqual(await res.json(), [{ id: 1 }]);
  assert.ok(seen[0].startsWith("https://jaaray.site/wp-json/wc/store/v1/products?"));
  assert.ok(!seen[0].includes("consumer_key"));
});

test("repli rest_route puis 404 clair ; chemin inconnu", async () => {
  const seen = [];
  const res = await handle(new Request("https://relais.test/products?site=shop.example"), async url => { seen.push(url); return { ok: false, status: 404, url, text: async () => "{}", headers: new Headers() }; });
  assert.equal(res.status, 404);
  assert.equal(seen.length, 2);
  assert.ok(seen[1].includes("rest_route"));
  assert.equal((await handle(new Request("https://relais.test/autre"))).status, 404);
  assert.equal((await handle(new Request("https://relais.test/products?site=127.0.0.1"))).status, 400);
});

test("Shopify : /products.json lu par page, réponse non Shopify refusée", async () => {
  const seen = [];
  const res = await handle(new Request("https://relais.test/shopify?site=boutique.example&page=2&limit=9999"), async url => { seen.push(url); return { ...ok('{"products":[{"id":1}]}'), url }; });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await res.json(), { products: [{ id: 1 }] });
  assert.equal(seen[0], "https://boutique.example/products.json?limit=250&page=2");
  const html = await handle(new Request("https://relais.test/shopify?site=jaaray.site"), async () => ok("<html></html>"));
  assert.equal(html.status, 404);
  const other = await handle(new Request("https://relais.test/shopify?site=jaaray.site"), async () => ok('{"items":[]}'));
  assert.equal(other.status, 404);
  assert.equal((await handle(new Request("https://relais.test/shopify?site=localhost"))).status, 400);
});

// Stockage KV simulé (get, put avec métadonnées, list par préfixe).
const kv = () => {
  const m = new Map();
  return {
    m,
    get: async k => (m.has(k) ? m.get(k).v : null),
    put: async (k, v, o = {}) => { m.set(k, { v, metadata: o.metadata }); },
    list: async ({ prefix }) => ({ keys: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.metadata })) })
  };
};
const HASH = "94ee059335e587e501cc4bf90613e0814f00a7b08bc7c648fd865a2af6a22cc2"; // SHA-256 de « TEST »
const post = (path, body) => new Request(`https://relais.test${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("rapports : publication réservée au code, affichage sans script, ouvertures comptées", async () => {
  const env = { RAPPORTS: kv(), ACCESS_HASH: HASH };
  const html = "<!doctype html><html><body>Audit</body></html>";
  assert.equal((await handle(post("/rapports", { code: "faux", html }), fetch, env)).status, 403);
  assert.equal((await handle(post("/rapports", { code: "test", html: "<script>x</script>" }), fetch, env)).status, 400);
  const created = await handle(post("/rapports", { code: "test", html, boutique: "jaaray.site" }), fetch, env);
  assert.equal(created.status, 201);
  const { id, url } = await created.json();
  assert.match(id, /^[A-Za-z0-9]{12}$/);
  assert.equal(url, `https://relais.test/r/${id}`);

  const page = await handle(new Request(url), fetch, env);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), html);
  assert.match(page.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex, nofollow");
  await handle(new Request(url), fetch, env);

  assert.equal((await handle(post("/rapports/suivi", { code: "faux" }), fetch, env)).status, 403);
  const rows = await (await handle(post("/rapports/suivi", { code: "test" }), fetch, env)).json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].store, "jaaray.site");
  assert.equal(rows[0].views, 2);
  assert.ok(rows[0].firstView && rows[0].lastView);

  assert.equal((await handle(new Request("https://relais.test/r/inconnu"), fetch, env)).status, 404);
  assert.equal((await handle(new Request("https://relais.test/r/ABCDEFGHJKLM"), fetch, env)).status, 404);
  assert.equal((await handle(post("/rapports", { code: "test", html }), fetch, {})).status, 503, "sans stockage : message clair");
});

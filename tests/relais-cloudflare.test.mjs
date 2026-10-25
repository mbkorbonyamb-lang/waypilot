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

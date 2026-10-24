// Lancer avec : node --test tests/woo.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");
const W = require("../woo.js");

// Réponses de l’API inspirées du pilote JAARAY : une variation M seulement, images en double, prix faux.
const api = () => ({
  products: [
    {
      id: 170, type: "variable", name: "Ensemble blanc cassé", status: "publish", sku: "", regular_price: "", sale_price: "",
      description: "<p>Ensemble en lin.</p>", short_description: "", categories: [{ id: 3, name: "Ensembles" }],
      images: [{ id: 11, src: "https://x.test/a.jpg" }], stock_status: "instock", manage_stock: false, stock_quantity: null,
      attributes: [{ id: 1, name: "Taille", position: 0, visible: true, variation: false, options: ["M", "L", "XL"] }]
    },
    {
      id: 200, type: "simple", name: "Kimono fluide vert", status: "publish", sku: "", regular_price: "445", sale_price: "",
      description: "<p>Prix : 446 €</p>", short_description: "", categories: [{ id: 4, name: "Kimonos" }],
      images: [{ id: 21, src: "https://x.test/k1.jpg" }, { id: 22, src: "https://x.test/k2.jpg" }, { id: 23, src: "https://x.test/k1.jpg" }],
      stock_status: "instock", manage_stock: false, stock_quantity: null, attributes: []
    }
  ],
  variations: {
    170: [{ id: 171, sku: "", regular_price: "300", sale_price: "", status: "publish", description: "", image: { id: 11, src: "https://x.test/a.jpg" },
      stock_status: "instock", manage_stock: false, stock_quantity: null, attributes: [{ id: 1, name: "Taille", option: "M" }] }]
  }
});

test("toCatalog : produits et variations au format du moteur", () => {
  const c = W.toCatalog(E, api());
  assert.equal(c.rows.length, 3);
  assert.equal(c.meta[1].kind, "variation");
  assert.equal(c.rows[1][c.col.parent], "id:170");
  assert.equal(c.rows[1][c.attrCols[0].valueCol], "M");
  assert.equal(c.rows[0][c.attrCols[0].valueCol], "M, L, XL");
  assert.equal(c.rows[0][c.attrCols[0].globalCol], "1");
});

test("analyse d’un catalogue API puis plan de corrections", () => {
  const c = W.toCatalog(E, api());
  const r = E.analyze(c, { skuPrefix: "JAA", decimal: "." });
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes("VARIATION_VALUE_MISSING"));
  assert.ok(codes.includes("IMAGE_DUPLICATE"));
  assert.ok(codes.includes("PRICE_DESC_MISMATCH"));
  r.proposals.forEach(p => { p.status = "approved"; });
  r.manualCandidates.forEach(v => { v.validated = true; });

  const plan = W.buildChanges(c, r.proposals, r.manualCandidates);
  assert.deepEqual(plan.skipped, []);
  const kimono = plan.products.find(p => p.payload.id === 200).payload;
  assert.equal(kimono.regular_price, "446");
  assert.deepEqual(kimono.images, [{ id: 21 }, { id: 22 }]);
  assert.match(kimono.sku, /^JAA-/);

  const parent = plan.products.find(p => p.payload.id === 170).payload;
  assert.equal(parent.attributes[0].variation, true, "attribut passé en « utilisé pour les variations »");
  assert.deepEqual(parent.attributes[0].options, ["M", "L", "XL"]);

  const v = plan.variations[170];
  assert.equal(v.update.length, 1);
  assert.equal(v.update[0].payload.id, 171);
  assert.deepEqual(v.create.map(x => x.payload.attributes[0]), [{ id: 1, option: "L" }, { id: 1, option: "XL" }]);
  assert.ok(v.create.every(x => x.payload.regular_price === "300" && x.payload.status === "publish" && !("stock_quantity" in x.payload)));
});

test("buildChanges : rien n’est envoyé sans validation", () => {
  const c = W.toCatalog(E, api());
  const r = E.analyze(c, { skuPrefix: "JAA", decimal: "." });
  const plan = W.buildChanges(c, r.proposals, r.manualCandidates);
  assert.equal(plan.count, 0);
});

test("normalizeStoreUrl : HTTPS obligatoire", () => {
  assert.equal(W.normalizeStoreUrl("jaaray.site/"), "https://jaaray.site");
  assert.equal(W.normalizeStoreUrl("https://jaaray.site/wp-json/wc/v3"), "https://jaaray.site");
  assert.throws(() => W.normalizeStoreUrl("http://jaaray.site"), /HTTPS/);
  assert.equal(W.normalizeStoreUrl("http://localhost:8080/shop"), "http://localhost:8080/shop");
});

// Faux serveur WooCommerce : pagination, lots, et une erreur par élément.
function fakeFetch(log) {
  const json = (status, data, headers = {}) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), headers: { get: h => headers[h] ?? null } });
  return async (url, init) => {
    const u = new URL(url);
    log.push({ method: init.method, path: u.pathname, page: u.searchParams.get("page"), body: init.body && JSON.parse(init.body) });
    assert.equal(u.searchParams.get("consumer_key"), "ck_test");
    if (u.pathname === "/wp-json/wc/v3/products" && init.method === "GET") {
      const page = Number(u.searchParams.get("page"));
      const items = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, type: "simple", name: `P${i + 1}` })) : [{ id: 500, type: "variable", name: "V" }];
      return json(200, items, { "X-WP-TotalPages": "2" });
    }
    if (u.pathname === "/wp-json/wc/v3/products/500/variations") return json(200, [{ id: 501, attributes: [] }]);
    if (u.pathname === "/wp-json/wc/v3/products/batch") {
      const body = JSON.parse(init.body);
      return json(200, { update: body.update.map(x => x.id === 2 ? { id: 2, error: { code: "product_invalid_sku", message: "UGS déjà utilisée" } } : { id: x.id }) });
    }
    if (u.pathname === "/wp-json/wc/v3/products/500/variations/batch") {
      const body = JSON.parse(init.body);
      return json(200, { create: (body.create || []).map((_, i) => ({ id: 900 + i })), update: (body.update || []).map(x => ({ id: x.id })) });
    }
    return json(404, { code: "rest_no_route", message: "Aucune route" });
  };
}

test("client : lecture paginée et application par lots", async () => {
  const log = [];
  const client = W.createClient({ url: "https://shop.test", key: "ck_test", secret: "cs_test", fetchImpl: fakeFetch(log) });
  const data = await client.fetchCatalog();
  assert.equal(data.products.length, 101);
  assert.equal(data.variations[500].length, 1);

  const results = await client.applyChanges({
    products: [{ label: "P1", payload: { id: 1, sku: "A" } }, { label: "P2", payload: { id: 2, sku: "A" } }],
    variations: { 500: { update: [], create: [{ label: "V - L", payload: { regular_price: "10", attributes: [] } }] } }
  });
  assert.deepEqual(results.map(r => [r.label, r.ok]), [["P1", true], ["P2", false], ["V - L", true]]);
  assert.equal(results[1].error, "UGS déjà utilisée");
  assert.ok(!log.some(l => l.path.endsWith("/variations/batch") && l.body && l.body.update), "pas de lot vide envoyé");
});

test("client : clés au mauvais format refusées avant tout appel", () => {
  assert.throws(() => W.createClient({ url: "https://shop.test", key: "abc", secret: "cs_x", fetchImpl: async () => {} }), /ck_/);
});

test("doublons de variations : l’ID le plus ancien est gardé, les autres sont proposés à la suppression", () => {
  const data = api();
  // L’API renvoie les variations les plus récentes d’abord.
  data.variations[170] = [
    { id: 336, sku: "", regular_price: "", status: "publish", attributes: [{ id: 1, name: "Taille", option: "M" }] },
    ...data.variations[170]
  ];
  const c = W.toCatalog(E, data);
  const csvLike = E.analyze(c, { skuPrefix: "JAA", decimal: "." });
  assert.ok(!csvLike.proposals.some(p => p.kind === "deleteVariation"), "pas de suppression proposée sans connexion directe");

  const r = E.analyze(c, { skuPrefix: "JAA", decimal: ".", allowDelete: true });
  const dup = r.issues.find(i => i.code === "VARIATION_DUPLICATE");
  assert.equal(dup.productId, "336");
  assert.match(dup.message, /ID 171/);
  const del = r.proposals.find(p => p.kind === "deleteVariation");
  assert.equal(del.productId, "336");
  assert.equal(del.safe, false);
  assert.deepEqual(dup.proposalIds, [del.id]);
  assert.ok(!r.proposals.some(p => p.kind === "sku" && p.productId === "336"), "pas d’UGS pour un doublon");

  r.proposals.forEach(p => { p.status = "approved"; });
  const plan = W.buildChanges(c, r.proposals, []);
  assert.deepEqual(plan.variations[170].delete.map(d => d.payload), [336]);
  assert.ok(!plan.variations[170].update.some(u => u.payload.id === 336));
});

test("client : les suppressions partent avant les mises à jour", async () => {
  const log = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    log.push(Object.keys(body)[0]);
    const kind = Object.keys(body)[0];
    return { ok: true, status: 200, text: async () => JSON.stringify({ [kind]: body[kind].map(x => ({ id: typeof x === "number" ? x : x.id })) }), headers: { get: () => null } };
  };
  const client = W.createClient({ url: "https://shop.test", key: "ck_a", secret: "cs_b", fetchImpl });
  const res = await client.applyChanges({ products: [], variations: { 1: { delete: [{ label: "d", payload: 9 }], update: [{ label: "u", payload: { id: 2 } }], create: [] } } });
  assert.deepEqual(log, ["delete", "update"]);
  assert.ok(res.every(r => r.ok));
});

test("journal et retour arrière : anciennes valeurs, variations créées supprimées, suppressions signalées", async () => {
  const data = api();
  data.variations[170] = [{ id: 336, sku: "", regular_price: "300", status: "publish", attributes: [{ id: 1, name: "Taille", option: "M" }] }, ...data.variations[170]];
  const c = W.toCatalog(E, data);
  const r = E.analyze(c, { skuPrefix: "JAA", decimal: ".", allowDelete: true });
  r.proposals.forEach(p => { p.status = "approved"; });
  r.manualCandidates.forEach(v => { v.validated = true; });
  const plan = W.buildChanges(c, r.proposals, r.manualCandidates);

  const sent = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); const kind = Object.keys(body)[0];
    sent.push([new URL(url).pathname, body]);
    return { ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ [kind]: body[kind].map((x, i) => ({ id: typeof x === "number" ? x : (x.id || 900 + i) })) }) };
  };
  const client = W.createClient({ url: "https://shop.test", key: "ck_a", secret: "cs_b", fetchImpl });
  const results = await client.applyChanges(plan);
  assert.ok(results.every(x => x.ok));

  const journal = W.buildJournalCSV(results, { site: "https://shop.test", date: "2026-10-24" });
  assert.match(journal, /"prix régulier";"445";"446";"Appliquée"/);
  assert.match(journal, /"UGS";"";"JAA-002";"Appliquée"/);

  const back = W.buildRollback(results);
  const kimono = back.products.find(p => p.payload.id === 200).payload;
  assert.deepEqual(kimono, { id: 200, sku: "", regular_price: "445", images: [{ id: 21 }, { id: 22 }, { id: 23 }] });
  const parent = back.products.find(p => p.payload.id === 170).payload;
  assert.equal(parent.attributes[0].variation, false);
  assert.deepEqual(back.variations[170].delete.map(d => d.payload), [900, 901], "variations créées supprimées");
  assert.equal(back.notReversible.length, 1, "la suppression du doublon n’est pas réversible");
});

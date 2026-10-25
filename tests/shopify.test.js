// Lancer avec : node --test tests/shopify.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");
const S = require("../shopify.js");

// Extrait de /products.json : un produit à options (taille), un produit simple (« Default Title »).
const data = () => ({
  products: [
    {
      id: 10, title: "Robe lin", body_html: "<p>Robe en lin.</p>", product_type: "Robes",
      options: [{ name: "Taille", position: 1, values: ["S", "M"] }],
      images: [{ id: 1, src: "https://cdn.test/r1.jpg", alt: null }, { id: 2, src: "https://cdn.test/r2.jpg", alt: "Robe lin dos" }],
      variants: [
        { id: 102, title: "M", option1: "M", option2: null, option3: null, sku: "RL-M", price: "59.00", compare_at_price: null, available: false, featured_image: null },
        { id: 101, title: "S", option1: "S", option2: null, option3: null, sku: "RL-S", price: "49.00", compare_at_price: "69.00", available: true, featured_image: null }
      ]
    },
    {
      id: 20, title: "Foulard", body_html: "", product_type: "",
      options: [{ name: "Title", position: 1, values: ["Default Title"] }],
      images: [],
      variants: [{ id: 201, title: "Default Title", option1: "Default Title", sku: "", price: "15.00", compare_at_price: "15.00", available: true }]
    }
  ]
});

test("conversion : produit variable + variantes, produit simple, prix barré", () => {
  const c = S.shopifyToCatalog(E, data());
  assert.equal(c.rows.length, 4);
  assert.equal(c.source, "public");
  assert.equal(c.platform, "shopify");
  const [parent, s, m, simple] = c.rows;
  assert.equal(parent[c.col.type], "variable");
  assert.equal(parent[c.attrCols[0].valueCol], "S, M");
  assert.equal(s[c.col.parent], "id:10");
  assert.equal(s[c.attrCols[0].valueCol], "S");
  assert.equal(s[c.col.price], "69.00");
  assert.equal(s[c.col.salePrice], "49.00");
  assert.equal(m[c.col.price], "59.00");
  assert.equal(simple[c.col.type], "simple");
  assert.equal(simple[c.col.price], "15.00");
  assert.equal(simple[c.col.salePrice], "");
  assert.deepEqual(c.imageAlt[0], [{ src: "https://cdn.test/r1.jpg", alt: "" }, { src: "https://cdn.test/r2.jpg", alt: "Robe lin dos" }]);
});

test("analyse : pas d’alerte UGS sur le produit à options, alertes réelles conservées", () => {
  const r = E.analyze(S.shopifyToCatalog(E, data()));
  const codes = r.issues.map(i => `${i.productId}:${i.code}`);
  assert.ok(!codes.includes("10:SKU_MISSING"));
  assert.ok(codes.includes("20:SKU_MISSING"));
  assert.ok(codes.includes("10:IMAGE_ALT_MISSING"));
  assert.ok(codes.includes("20:IMAGE_MISSING"));
  assert.ok(codes.includes("20:CATEGORY_MISSING"));
});

test("sans type de produit ni texte alternatif renvoyé : aucun contrôle correspondant", () => {
  const d = data();
  d.products.forEach(p => { p.product_type = ""; p.images.forEach(i => { delete i.alt; }); });
  const c = S.shopifyToCatalog(E, d);
  assert.equal(c.imageAlt, undefined);
  const codes = E.analyze(c).issues.map(i => i.code);
  assert.ok(!codes.includes("CATEGORY_MISSING") && !codes.includes("CATEGORY_COLUMN_MISSING") && !codes.includes("IMAGE_ALT_MISSING"));
});

test("client : pages de 250, arrêt sur page courte, erreurs claires", async () => {
  const seen = [];
  const full = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, variants: [] }));
  const client = S.createShopifyClient({ url: "https://Boutique.example/collections/all", relay: "https://relais.test/", fetchImpl: async url => {
    seen.push(url);
    const page = new URL(url).searchParams.get("page");
    return { ok: true, status: 200, text: async () => JSON.stringify({ products: page === "1" ? full : [{ id: 999, variants: [] }] }) };
  } });
  const { products } = await client.fetchCatalog();
  assert.equal(products.length, 251);
  assert.equal(seen.length, 2);
  assert.ok(seen[0].startsWith("https://relais.test/shopify?site=boutique.example&page=1"));
  const missing = S.createShopifyClient({ url: "jaaray.site", relay: "https://relais.test", fetchImpl: async () => ({ ok: false, status: 404, text: async () => "{}" }) });
  await assert.rejects(missing.fetchCatalog(), /introuvable/);
  const locked = S.createShopifyClient({ url: "x.example", relay: "https://relais.test", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "{}" }) });
  await assert.rejects(locked.fetchCatalog(), /mot de passe/);
});

test("score : jamais 100 % s’il reste une anomalie, même sur un grand catalogue", () => {
  const products = Array.from({ length: 600 }, (_, i) => ({ id: i + 1, title: `Produit ${i + 1}`, body_html: "<p>Texte.</p>", product_type: "", options: [{ name: "Title", values: ["Default Title"] }],
    images: [{ src: `https://cdn.test/${i}.jpg` }], variants: [{ id: 10000 + i, title: "Default Title", sku: `P${i}`, price: "10.00", available: true }] }));
  products[0].images = [];
  const r = E.analyze(S.shopifyToCatalog(E, { products }));
  assert.ok(r.issues.length > 0);
  assert.equal(r.stats.score, 99);
});

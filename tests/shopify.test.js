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

test("doublon d’UGS : le message nomme le produit qui porte déjà la référence", () => {
  const d = data();
  d.products[1].variants[0].sku = "RL-S";
  const issue = E.analyze(S.shopifyToCatalog(E, d)).issues.find(i => i.code === "SKU_DUPLICATE");
  assert.match(issue.message, /« RL-S » déjà utilisée par « Robe lin - S » \(ligne 3\)/);
});

test("lignes techniques d’applis (Redo, Route…) ignorées : pas de fausse alerte UGS en double", () => {
  const redo = (id, price) => ({ id, title: `Free Returns Coverage - $${price}`, vendor: "re:do", body_html: "", product_type: "", images: [], options: [{ name: "Title", values: ["Default Title"] }], variants: [{ id: id * 10, title: "Default Title", sku: "x-redo", price, available: true }] });
  const d = data();
  d.products.push(redo(901, "0.80"), redo(902, "4.98"));
  const c = S.shopifyToCatalog(E, d);
  assert.equal(c.ignored.length, 2);
  assert.equal(c.rows.length, S.shopifyToCatalog(E, data()).rows.length);
  assert.ok(!E.analyze(c).issues.some(i => i.code === "SKU_DUPLICATE"));
});

test("détection technique : vrais produits conservés", () => {
  assert.equal(S.isTechnical({ title: "Shipping Protection", vendor: "Boutique", variants: [] }), true);
  assert.equal(S.isTechnical({ title: "Route Package Protection", vendor: "Route", variants: [] }), true);
  assert.equal(S.isTechnical({ title: "Sac de voyage", vendor: "Route 66", variants: [{ sku: "R66-1" }] }), false);
  assert.equal(S.isTechnical({ title: "Robe longue", vendor: "Extended Studio", variants: [{ sku: "ROBE-1" }] }), false);
});

test("Shopify : taille des images reprise du catalogue, sans téléchargement", () => {
  const d = data();
  d.products[0].images = [{ src: "https://cdn.test/a.jpg", width: 2000, height: 3000 }];
  const c = S.shopifyToCatalog(E, d);
  assert.deepEqual(c.knownSizes["https://cdn.test/a.jpg"], { width: 2000, height: 3000 });
});

test("valeur d’option avec virgule (carte cadeau « 100,00 € ») : pas de fausse alerte", () => {
  const p = { id: 7, title: "Carte-cadeau", product_type: "", options: [{ name: "Montant", values: ["50,00 €", "100,00 €"] }],
    variants: [{ id: 71, sku: "CC50", price: "50.00", option1: "50,00 €", available: true }, { id: 72, sku: "CC100", price: "100.00", option1: "100,00 €", available: true }],
    images: [{ src: "https://x.test/c.jpg" }] };
  const r = E.analyze(S.shopifyToCatalog(E, { products: [p] }));
  assert.ok(!r.issues.some(i => /^VARIATION_VALUE/.test(i.code)), r.issues.map(i => i.code).join(" "));
});

test("même SKU sur toutes les tailles d’un modèle Shopify : faible, pas élevée", () => {
  const mk = (id, sku, opts) => ({ id, title: `Basket ${id}`, product_type: "", options: [{ name: "Taille", values: opts }],
    variants: opts.map((o, n) => ({ id: id * 10 + n, sku: typeof sku === "function" ? sku(n) : sku, price: "159.00", option1: o, available: true })), images: [{ src: `https://x.test/${id}.jpg` }] });
  const r = E.analyze(S.shopifyToCatalog(E, { products: [mk(1, "MOE-GEN1", ["39", "40", "41"]), mk(2, n => n ? `B-${n}` : "MOE-GEN1", ["39", "40"])] }));
  const codes = r.issues.map(i => `${i.code}:${i.severity}`);
  assert.equal(codes.filter(c => c === `SKU_SHARED_MODEL:${E.SEVERITY.LOW}`).length, 2, codes.join(" "));
  assert.equal(codes.filter(c => c.startsWith("SKU_DUPLICATE")).length, 1, "autre produit : toujours élevée");
});

test("prix d’une variation 10 fois plus bas que les autres : moyenne (faute de frappe ?)", () => {
  const p = { id: 3, title: "Robe", product_type: "", options: [{ name: "Taille", values: ["S", "M", "L", "XL"] }],
    variants: ["S", "M", "L", "XL"].map((o, n) => ({ id: 30 + n, sku: `R-${o}`, price: o === "L" ? "15.90" : "159.00", option1: o, available: true })), images: [{ src: "https://x.test/r.jpg" }] };
  const r = E.analyze(S.shopifyToCatalog(E, { products: [p] }));
  const hits = r.issues.filter(i => i.code === "VARIATION_PRICE_OUTLIER");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, E.SEVERITY.MEDIUM);
  assert.match(hits[0].message, /15,90.*159,00/);
  const ok = E.analyze(S.shopifyToCatalog(E, { products: [{ ...p, variants: p.variants.map(v => ({ ...v, price: v.option1 === "XL" ? "179.00" : "159.00" })) }] }));
  assert.ok(!ok.issues.some(i => i.code === "VARIATION_PRICE_OUTLIER"), "écart normal entre tailles : rien");
});

test("bon cadeau : montants différents par variation, pas de prix aberrant", () => {
  const p = { id: 4, title: "Bons cadeaux", product_type: "", options: [{ name: "Montant", values: ["10", "50", "100", "500"] }],
    variants: ["10", "50", "100", "500"].map((o, n) => ({ id: 40 + n, sku: `BC-${o}`, price: `${o}.00`, option1: o, available: true })), images: [{ src: "https://x.test/b.jpg" }] };
  const r = E.analyze(S.shopifyToCatalog(E, { products: [p] }));
  assert.ok(!r.issues.some(i => i.code === "VARIATION_PRICE_OUTLIER"));
});

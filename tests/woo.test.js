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
  assert.deepEqual(kimono.images, [{ id: 21, alt: "Kimono fluide vert" }, { id: 22, alt: "Kimono fluide vert – vue 2" }], "doublon retiré et textes alternatifs ajoutés");
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
  assert.deepEqual(kimono, { id: 200, sku: "", regular_price: "445", images: [{ id: 21, alt: "" }, { id: 22, alt: "" }, { id: 23, alt: "" }] }, "galerie et textes d’origine");
  const parent = back.products.find(p => p.payload.id === 170).payload;
  assert.equal(parent.attributes[0].variation, false);
  assert.deepEqual(back.variations[170].delete.map(d => d.payload), [900, 901], "variations créées supprimées");
  assert.equal(back.notReversible.length, 1, "la suppression du doublon n’est pas réversible");
});

test("toCatalog : GTIN natif ou d’extension, texte alternatif des images", () => {
  const data = api();
  data.products[1].global_unique_id = "4006381333932";
  data.products[1].images[0].alt = "Kimono vert";
  data.products[0].meta_data = [{ key: "_wpm_gtin_code", value: "4006381333931" }];
  const c = W.toCatalog(E, data);
  assert.ok(c.col.gtin >= 0);
  assert.equal(c.rows[0][c.col.gtin], "4006381333931");
  assert.equal(c.rows[2][c.col.gtin], "4006381333932");
  const r = E.analyze(c, { decimal: "." });
  assert.ok(r.issues.some(i => i.code === "GTIN_INVALID" && i.productId === "200"));
  const alt = r.issues.find(i => i.code === "IMAGE_ALT_MISSING" && i.productId === "200");
  assert.match(alt.message, /^1 image\(s\) sur 2/, "images répétées comptées une fois");
  // Boutique sans champ GTIN (WooCommerce ancien) : pas de colonne, pas de contrôle.
  assert.equal(W.toCatalog(E, api()).col.gtin, -1);
});

// Réponses de l’API publique (Store API), relevées sur jaaray.site : montants en unités mineures, valeurs de variation en slug.
const storeApi = () => ({
  products: [
    { id: 176, type: "variable", name: "Ensemble orange", sku: "AAR-001", short_description: "", description: "<p>Ensemble</p>", on_sale: false,
      prices: { price: "42100", regular_price: "42100", sale_price: "42100", currency_minor_unit: 2 },
      images: [{ id: 32, src: "https://x.test/o.jpg", alt: "Ensemble orange" }], categories: [{ id: 3, name: "Ensembles" }],
      attributes: [{ id: 2, name: "Taille", taxonomy: "pa_taille", has_variations: true, terms: [{ id: 5, name: "M", slug: "m" }, { id: 6, name: "L", slug: "l" }, { id: 7, name: "XL", slug: "xl" }, { id: 8, name: "Taille unique", slug: "taille-unique" }] }],
      variations: [{ id: 177, attributes: [{ name: "pa_taille", value: "xl" }] }, { id: 308, attributes: [{ name: "pa_taille", value: "m" }] }, { id: 309, attributes: [{ name: "pa_taille", value: "taille-unique" }] }],
      is_purchasable: true, is_in_stock: true },
    { id: 200, type: "simple", name: "Kimono", sku: "", short_description: "", description: "<p>Kimono</p>", on_sale: true,
      prices: { price: "39900", regular_price: "44600", sale_price: "39900", currency_minor_unit: 2 },
      images: [{ id: 21, src: "https://x.test/k.jpg", alt: "" }], categories: [{ id: 4, name: "Kimonos" }], attributes: [], variations: [],
      is_purchasable: false, is_in_stock: true }
  ],
  variations: {
    176: [
      { id: 309, parent: 176, type: "variation", sku: "AAR-001-TU", on_sale: false, prices: { regular_price: "42100", sale_price: "42100", currency_minor_unit: 2 }, images: [], is_purchasable: true, is_in_stock: true },
      { id: 177, parent: 176, type: "variation", sku: "AAR-001-XL", on_sale: false, prices: { regular_price: "42100", sale_price: "42100", currency_minor_unit: 2 }, images: [{ src: "https://x.test/o.jpg", alt: "" }], is_purchasable: true, is_in_stock: true },
      { id: 308, parent: 176, type: "variation", sku: "AAR-001-M", on_sale: false, prices: { regular_price: "42100", sale_price: "42100", currency_minor_unit: 2 }, images: [], is_purchasable: true, is_in_stock: false }
    ]
  }
});

test("audit express : catalogue public converti (montants, slugs, achetable) et analysé", () => {
  const c = W.publicToCatalog(E, storeApi());
  assert.equal(c.source, "public");
  assert.equal(c.rows.length, 5);
  const kimono = c.rows.find(r => r[0] === "200");
  assert.equal(kimono[c.col.price], "446");
  assert.equal(kimono[c.col.salePrice], "399");
  assert.equal(kimono[c.col.purchasable], "0");
  const xl = c.rows.find(r => r[0] === "177");
  assert.equal(xl[c.attrCols[0].valueCol], "XL", "slug remplacé par le nom du terme");
  assert.equal(c.rows.find(r => r[0] === "309")[c.attrCols[0].valueCol], "Taille unique");
  assert.deepEqual(c.rows.map(r => r[0]), ["176", "177", "308", "309", "200"], "variations triées par ID");

  const r = E.analyze(c, { decimal: "." });
  const found = r.issues.map(i => `${i.productId}:${i.code}`);
  assert.ok(found.includes("200:NOT_PURCHASABLE"));
  assert.ok(r.issues.some(i => i.code === "VARIATION_VALUE_MISSING" && i.value === "L"), "taille L affichée sans variation visible");
  assert.ok(found.includes("200:IMAGE_ALT_MISSING"));
  assert.ok(!found.some(x => x.startsWith("176:PRICE")), "pas de prix attendu sur le parent variable");
});

test("audit express : produit externe (« Prendre rendez-vous ») sans alerte Non achetable", () => {
  const data = storeApi();
  data.products[1].type = "external";
  const r = E.analyze(W.publicToCatalog(E, data), { decimal: "." });
  assert.ok(!r.issues.some(i => i.code === "NOT_PURCHASABLE"));
});

test("audit express : lecture sans clé, variations par lots, message clair si l’API est bloquée", async () => {
  const data = storeApi();
  const calls = [];
  const fetchImpl = async url => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    assert.ok(!u.searchParams.has("consumer_key"), "aucune clé envoyée");
    const body = u.searchParams.get("type") === "variation" ? data.variations[176].filter(v => u.searchParams.get("include").split(",").includes(String(v.id))) : data.products;
    return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: { get: () => "1" } };
  };
  const client = W.createPublicClient({ url: "jaaray.site", fetchImpl });
  const got = await client.fetchCatalog();
  assert.equal(got.products.length, 2);
  assert.equal(got.variations[176].length, 3);
  assert.ok(calls[0].startsWith("/wp-json/wc/store/v1/products?"));
  assert.ok(calls.some(c => c.includes("include=177%2C308%2C309")));

  const blocked = W.createPublicClient({ url: "shop.test", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "{\"message\":\"non\"}", headers: { get: () => null } }) });
  await assert.rejects(blocked.fetchCatalog(), /bloque la lecture publique/);
});

test("audit express via le relais : seule l’adresse de la boutique est transmise", async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return { ok: true, status: 200, text: async () => "[]", headers: { get: () => "1" } }; };
  await W.createPublicClient({ url: "https://www.jaaray.site/", relay: "https://relais.test/", fetchImpl }).fetchCatalog();
  assert.equal(urls[0], "https://relais.test/products?site=www.jaaray.site&per_page=100&page=1");
});

test("buildChanges : texte alternatif des images à partir du nom du produit", () => {
  const data = api();
  data.products[1].images[1].alt = "Kimono vert, dos";
  const c = W.toCatalog(E, data);
  const r = E.analyze(c, { decimal: "." });
  const alt = r.proposals.find(p => p.kind === "imageAlt" && p.productId === "200");
  assert.ok(alt, "proposition créée avec une clé API");
  assert.equal(alt.after, "Kimono fluide vert");
  assert.ok(r.issues.find(i => i.code === "IMAGE_ALT_MISSING" && i.productId === "200").proposalIds.includes(alt.id));

  // Seule : toute la galerie est renvoyée, seuls les textes vides sont remplis.
  alt.status = "approved";
  let ch = W.buildChanges(c, r.proposals);
  let k = ch.products.find(x => x.payload.id === 200);
  assert.deepEqual(k.payload.images, [
    { id: 21, alt: "Kimono fluide vert" }, { id: 22, alt: "Kimono vert, dos" }, { id: 23, alt: "Kimono fluide vert" }
  ]);
  assert.match(k.label, /texte alternatif sur 1 image/);
  assert.deepEqual(k.undo.images, [{ id: 21, alt: "" }, { id: 22, alt: "Kimono vert, dos" }, { id: 23, alt: "" }]);

  // Avec le dédoublonnage : la liste réduite garde les textes.
  r.proposals.find(p => p.kind === "images" && p.productId === "200").status = "approved";
  ch = W.buildChanges(c, r.proposals);
  k = ch.products.find(x => x.payload.id === 200);
  assert.deepEqual(k.payload.images, [{ id: 21, alt: "Kimono fluide vert" }, { id: 22, alt: "Kimono vert, dos" }]);

  // Audit express : aucune proposition (rien ne peut être écrit).
  const pub = { ...c, source: "public" };
  assert.ok(!E.analyze(pub, { decimal: "." }).proposals.some(p => p.kind === "imageAlt"));
});

test("buildChanges : vue 2, vue 3 quand aucune image n’a de texte", () => {
  const data = api();
  data.products[1].images = [{ id: 21, src: "https://x.test/k1.jpg" }, { id: 22, src: "https://x.test/k2.jpg" }, { id: 24, src: "https://x.test/k3.jpg" }];
  const c = W.toCatalog(E, data);
  const r = E.analyze(c, { decimal: "." });
  r.proposals.filter(p => p.kind === "imageAlt").forEach(p => { p.status = "approved"; });
  const k = W.buildChanges(c, r.proposals).products.find(x => x.payload.id === 200);
  assert.deepEqual(k.payload.images.map(i => i.alt), ["Kimono fluide vert", "Kimono fluide vert – vue 2", "Kimono fluide vert – vue 3"]);
});

test("site multilingue (un domaine par langue) : seule la langue auditée est gardée, plus de faux doublons d’UGS", async () => {
  const p = (id, name, sku, link) => ({ id, name, sku, type: "simple", permalink: link, prices: { regular_price: "10000", currency_minor_unit: 2 }, images: [], categories: [], attributes: [] });
  const products = [
    p(7354, "Kluis Newton S2 80L", "NCS80", "https://www.fichet-bauche.nl/product/kluis-newton-s2-80l/"),
    p(7353, "Newton S2 safe 80L", "NCS80", "https://www.fichet-bauche.com/product/newton-s2-safe-80l/"),
    p(7352, "Coffre-fort Newton S2 80L", "NCS80", "https://www.fichet-bauche.fr/produit/coffre-fort-newton-s2-80l/"),
    p(8648, "Coffre-fort Complice BO 80L", "PCF80", "https://www.fichet-bauche.fr/produit/coffre-fort-complice-bo-80l/")
  ];
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(products), headers: { get: () => "1" } });
  const got = await W.createPublicClient({ url: "fichet-bauche.fr", fetchImpl }).fetchCatalog();
  assert.deepEqual(got.products.map(x => x.id), [7352, 8648]);
  assert.deepEqual(got.others, [{ language: "fichet-bauche.nl", count: 1 }, { language: "fichet-bauche.com", count: 1 }]);
  const c = W.publicToCatalog(E, got);
  assert.equal(c.otherLanguages.length, 2);
  assert.ok(!E.analyze(c).issues.some(i => i.code === "SKU_DUPLICATE"));
});

test("site multilingue par préfixe ou ?lang= : langue par défaut gardée ; site d’une seule langue inchangé", () => {
  const p = (id, link) => ({ id, permalink: link });
  const prefixed = W.splitLanguages([p(1, "https://shop.test/produit/a/"), p(2, "https://shop.test/en/product/a/"), p(3, "https://shop.test/produit/b/"), p(4, "https://shop.test/product/a/?lang=de")], "https://shop.test");
  assert.deepEqual(prefixed.products.map(x => x.id), [1, 3]);
  assert.deepEqual(prefixed.others.map(o => o.language).sort(), ["shop.test/de", "shop.test/en"]);
  const single = W.splitLanguages([p(1, "https://shop.test/produit/a/"), p(2, "https://shop.test/produit/b/")], "https://shop.test");
  assert.equal(single.products.length, 2);
  assert.deepEqual(single.others, []);
});

test("site multilingue : adresse auditée absente des liens → langue la plus fournie", () => {
  const p = (id, link) => ({ id, permalink: link });
  const r = W.splitLanguages([p(1, "https://a.test/fr/x/"), p(2, "https://a.test/fr/y/"), p(3, "https://a.test/en/x/")], "https://boutique.test");
  assert.deepEqual(r.products.map(x => x.id), [1, 2]);
});

test("produit vitrine (prix 0, non achetable, « Lire la suite ») : faible, pas « prix nul » élevé", () => {
  const p = (id, purchasable) => ({ id, name: `Porte forte ${id}`, sku: `P${id}`, type: "simple", description: "<p>Porte blindée</p>", is_purchasable: purchasable, is_in_stock: true, prices: { price: "0", regular_price: "0", currency_minor_unit: 2 }, images: [{ src: `https://x.test/${id}.jpg` }], categories: [{ name: "Portes" }], attributes: [] });
  const r = E.analyze(W.publicToCatalog(E, { products: [p(363, false), p(364, true)], variations: {} }));
  const byLine = r.issues.map(i => `${i.line}:${i.code}:${i.severity}`);
  assert.ok(byLine.includes(`2:PRICE_ON_REQUEST:${E.SEVERITY.LOW}`), byLine.join(" "));
  assert.ok(!byLine.some(x => x.startsWith("2:PRICE_NON_POSITIVE")));
  assert.ok(byLine.includes(`3:PRICE_NON_POSITIVE:${E.SEVERITY.HIGH}`), "achetable à 0 : toujours élevé");
});

test("carte cadeau à 0 € : pas d’alerte de prix (montant choisi par le client)", () => {
  const p = { id: 19348, name: "Carte cadeaux", sku: "", type: "gift-card", description: "<p>Carte</p>", is_purchasable: true, is_in_stock: true, prices: { price: "0", regular_price: "0", currency_minor_unit: 2 }, images: [{ src: "https://x.test/c.jpg" }], categories: [{ name: "Cadeaux" }], attributes: [] };
  const r = E.analyze(W.publicToCatalog(E, { products: [p], variations: {} }));
  assert.ok(!r.issues.some(i => /^PRICE_/.test(i.code)), r.issues.map(i => i.code).join(" "));
  assert.ok(E.productType("pw-gift-card").isGiftCard);
});

test("taille d’image WordPress déduite du srcset, sans téléchargement", () => {
  const img = { src: "https://x.test/robe.jpg", srcset: "https://x.test/robe.jpg 1200w, https://x.test/robe-200x300.jpg 200w, https://x.test/robe-683x1024.jpg 683w" };
  assert.deepEqual(W.sizeFromSrcset(img), { width: 1200, height: 1800 });
  assert.equal(W.sizeFromSrcset({ src: "https://x.test/a.jpg", srcset: "" }), null);
  assert.equal(W.sizeFromSrcset({ src: "https://x.test/a.jpg", srcset: "https://x.test/a.jpg 800w" }), null, "proportions inconnues");
  const p = { id: 1, name: "Robe", sku: "R", type: "simple", prices: { regular_price: "1000", currency_minor_unit: 2 }, images: [img], categories: [], attributes: [] };
  const c = W.publicToCatalog(E, { products: [p], variations: {} });
  assert.deepEqual(c.knownSizes["https://x.test/robe.jpg"], { width: 1200, height: 1800 });
});

test("montant en jeu : taille non commandable au prix des autres tailles, produit non achetable à son prix", () => {
  const data = storeApi();
  data.products.forEach(p => { p.prices.currency_code = "EUR"; });
  const c = W.publicToCatalog(E, data);
  assert.equal(c.currency, "EUR");
  const r = E.analyze(c, { decimal: "." });
  assert.equal(r.issues.find(i => i.code === "VARIATION_VALUE_MISSING" && i.value === "L").atStake, 421);
  assert.equal(r.issues.find(i => i.code === "NOT_PURCHASABLE").atStake, 446);
  assert.deepEqual(r.stats.atStake, { items: 2, total: 867, currency: "EUR" });
  assert.equal(E.prospectSummary(r).atStake.total, 867);
  const html = E.buildAuditReportHTML(r, { store: "jaaray.site" });
  assert.match(html, /867 € en jeu<\/strong> : 2 articles/);
  assert.match(html, /446 € en jeu/);
});

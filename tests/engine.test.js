// Lancer avec : node --test tests/engine.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../engine.js");

const fixture = name => E.parseCSV(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const codes = result => result.issues.map(i => `${i.line}:${i.code}`);

test("parseAmount : formats de prix courants", () => {
  assert.equal(E.parseAmount("12.5"), 12.5);
  assert.equal(E.parseAmount("12,50"), 12.5);
  assert.equal(E.parseAmount("1 200,00"), 1200);
  assert.equal(E.parseAmount("1.200,00"), 1200);
  assert.equal(E.parseAmount("1,234.56"), 1234.56);
  assert.equal(E.parseAmount("1.200"), 1200);
  assert.equal(E.parseAmount("0.500"), 0.5);
  assert.equal(E.parseAmount("-3"), -3);
  assert.ok(Number.isNaN(E.parseAmount("12 EUR")));
  // Format imposé : un entier sans séparateur reste un entier.
  assert.equal(E.parseAmount("445", "."), 445);
  assert.equal(E.parseAmount("445", ","), 445);
  assert.ok(Number.isNaN(E.parseAmount("1.2.3,4")));
  assert.ok(Number.isNaN(E.parseAmount("")));
});

test("parseAmount : séparateur décimal imposé", () => {
  assert.equal(E.parseAmount("1.200", "."), 1.2);
  assert.equal(E.parseAmount("1,200", ","), 1.2);
  assert.ok(Number.isNaN(E.parseAmount("12.5", ",")));
});

test("extractAmounts : point décimal, symboles, espaces ambigus", () => {
  assert.deepEqual(E.extractAmounts("Prix 12.50 EUR").map(a => a.value), [12.5]);
  assert.deepEqual(E.extractAmounts("19,99 €").map(a => a.value), [19.99]);
  assert.deepEqual(E.extractAmounts("$ 30").map(a => a.value), [30]);
  assert.deepEqual(E.extractAmounts("Livraison par DHL").map(a => a.value), []);
  const [a] = E.extractAmounts("Taille 42 300 DH");
  assert.equal(a.value, 42300);
  assert.ok(a.alternatives.includes(300));
});

test("productType : types composés WooCommerce", () => {
  assert.ok(E.productType("variation, virtual").isVariation);
  assert.ok(E.productType("Grouped").isGrouped);
});

test("parseCSV : numéros de ligne avec descriptions multilignes", () => {
  const c = fixture("woocommerce-fr-multi-attributs.csv");
  assert.equal(c.delimiter, ";");
  assert.equal(c.lines[0], 2);
  assert.equal(c.lines[1], 4);
  assert.deepEqual(c.attrCols.map(a => a.n), [1, 2]);
});

test("parseCSV : fichier tronqué refusé", () => {
  assert.throws(() => E.parseCSV('a,b,c\n1,"ouvert,3\n'), /tronqué/);
});

test("catalogue FR multi-attributs : aucun faux positif", () => {
  const r = E.analyze(fixture("woocommerce-fr-multi-attributs.csv"), { skuPrefix: "JAA" });
  const found = codes(r);
  // 12.50 EUR = 12.5, « Taille 42 300 DH » = 300, 1.200,00 valide, produit groupé sans prix,
  // taille × couleur sans faux doublon, « variation, virtual » reconnue.
  for (const code of ["PRICE_DESC_MISMATCH", "PRICE_INVALID", "PRICE_MISSING", "VARIATION_DUPLICATE", "VARIATION_PARENT_MISSING"]) {
    assert.ok(!found.some(x => x.endsWith(":" + code)), `${code} inattendu : ${found}`);
  }
  assert.deepEqual(found.sort(), ["10:STOCK_STATUS_MISMATCH", "7:VARIATION_VALUE_MISSING"].sort());
  // Deux attributs utilisés : pas d’ajout automatique, la combinaison serait ambiguë.
  assert.equal(r.manualCandidates.length, 0);
});

test("catalogue EN : parent par SKU, doublons, stock, casse", () => {
  const r = E.analyze(fixture("woocommerce-en-parent-sku.csv"), { skuPrefix: "dress" });
  const found = codes(r);
  assert.ok(!found.some(x => x.endsWith(":VARIATION_PARENT_MISSING")));
  for (const expected of ["2:IMAGE_DUPLICATE", "2:VARIATION_VALUE_MISSING", "7:SKU_DUPLICATE", "7:STOCK_NEGATIVE", "7:SALE_NOT_LOWER", "7:IMAGE_MISSING", "8:STOCK_STATUS_MISMATCH"]) {
    assert.ok(found.includes(expected), `${expected} manquant : ${found}`);
  }
  const casing = r.proposals.find(p => p.kind === "attributeValue");
  assert.equal(casing.before, "s");
  assert.equal(casing.after, "S");
  assert.equal(casing.safe, true);
  const dup = r.proposals.find(p => p.kind === "sku" && p.line === 7);
  assert.equal(dup.safe, false);
  assert.match(dup.note, /sans ID/);
  const skus = r.proposals.filter(p => p.kind === "sku").map(p => p.after);
  assert.equal(new Set(skus).size, skus.length);
  assert.ok(skus.every(s => s.startsWith("DRESS-")));
});

test("suite à donner : liée par code, pas par libellé", () => {
  const r = E.analyze(fixture("woocommerce-en-parent-sku.csv"), {});
  const byCode = code => r.issues.find(i => i.code === code);
  assert.equal(E.followupFor(byCode("IMAGE_DUPLICATE")), E.FOLLOWUP.PROPOSAL);
  assert.equal(E.followupFor(byCode("STOCK_NEGATIVE")), E.FOLLOWUP.HUMAN);
  assert.equal(E.followupFor(byCode("IMAGE_MISSING")), E.FOLLOWUP.MISSING_INFO);
  const missing = byCode("VARIATION_VALUE_MISSING");
  assert.equal(E.followupFor(missing, { verifiedExisting: new Set([missing.key]) }), E.FOLLOWUP.EXISTS);
});

test("variation ajoutée : aucune valeur de stock inventée", () => {
  const c = fixture("woocommerce-en-parent-sku.csv");
  const r = E.analyze(c, {});
  const [v] = r.manualCandidates;
  assert.equal(v.parentRef, "DRESS");
  assert.equal(v.attributeValue, "XL");
  assert.equal(v.price, "45");
  assert.equal(v.stockQty, "");
  v.validated = true;
  const out = E.parseCSV(E.buildCorrectedCSV(c, r.proposals, [v]));
  const added = out.rows[out.rows.length - 1];
  const at = h => added[out.headers.indexOf(h)];
  assert.equal(at("Type"), "variation");
  assert.equal(at("Parent"), "DRESS");
  assert.equal(at("Attribute 1 name"), "Size");
  assert.equal(at("Attribute 1 value(s)"), "XL");
  assert.equal(at("Attribute 1 global"), "1");
  assert.equal(at("Stock"), "");
  assert.equal(at("In stock?"), "");
});

test("CSV corrigé : seules les propositions validées sont appliquées", () => {
  const c = fixture("woocommerce-en-parent-sku.csv");
  const r = E.analyze(c, {});
  r.proposals.forEach(p => { p.status = p.kind === "images" ? "approved" : "rejected"; });
  const out = E.parseCSV(E.buildCorrectedCSV(c, r.proposals, []));
  assert.equal(out.rows.length, c.rows.length);
  assert.equal(out.rows[0][c.col.images], "https://x.test/1.jpg, https://x.test/2.jpg");
  assert.equal(out.rows[1][c.attrCols[0].valueCol], "s");
  // Le nom commençant par « = » est conservé tel quel pour WooCommerce.
  assert.equal(out.rows[4][c.col.name], '=HYPERLINK("http://evil.test")');
});

test("rapport : formules neutralisées", () => {
  const r = E.analyze(fixture("woocommerce-en-parent-sku.csv"), {});
  r.issues.push({ line: 6, product: '=HYPERLINK("x")', code: "TEST", message: "-test", severity: "Faible" });
  const report = E.buildReportCSV(r.issues);
  assert.ok(report.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(report.includes(`"'-test"`));
});

test("colonnes absentes : une seule anomalie globale", () => {
  const c = E.parseCSV("Name,Regular price,Type\nA,10,simple\nB,12,simple\n");
  const r = E.analyze(c, {});
  assert.equal(r.issues.filter(i => i.code === "CATEGORY_COLUMN_MISSING").length, 1);
  assert.equal(r.issues.filter(i => i.code === "DESCRIPTION_COLUMN_MISSING").length, 1);
});

test("performance : 20 000 lignes en moins de 3 secondes", () => {
  const lines = ["ID,Type,SKU,Name,Regular price,Description,Categories,Images,Parent,Attribute 1 name,Attribute 1 value(s)"];
  for (let i = 0; i < 5000; i++) {
    lines.push(`${i * 5 + 1},variable,,Produit ${i},,Desc,Cat,https://x.test/${i}.jpg,,Taille,"S, M, L, XL"`);
    ["S", "M", "L", "XL"].forEach((s, k) => lines.push(`${i * 5 + 2 + k},variation,,Produit ${i} - ${s},10,,,,id:${i * 5 + 1},Taille,${s}`));
  }
  const t0 = Date.now();
  const r = E.analyze(E.parseCSV(lines.join("\n")), { skuPrefix: "PERF" });
  const ms = Date.now() - t0;
  assert.equal(r.stats.rows, 25000);
  assert.ok(ms < 3000, `${ms} ms`);
});

test("1.7.1 : noms sans HTML, ID WooCommerce, libellé des tailles sans variation", () => {
  const c = fixture("woocommerce-fr-theme-span.csv");
  const r = E.analyze(c, {});
  const variationProposal = r.proposals.find(p => p.row === 1);
  assert.equal(variationProposal.product, "Ensemble blanc cassé - M");
  assert.equal(variationProposal.productId, "171");
  const missing = r.issues.filter(i => i.code === "VARIATION_VALUE_MISSING");
  assert.deepEqual(missing.map(i => i.value), ["L", "XL"]);
  assert.equal(missing[0].productId, "170");
  assert.match(missing[0].message, /onglet Variations/);
  assert.equal(r.manualCandidates[0].name, "Ensemble blanc cassé - L");
  const report = E.buildReportCSV(r.issues);
  assert.ok(report.split("\r\n")[0].includes('"ID"'));
  assert.ok(report.includes('"170"'));
});

test("1.7.1 : le score tient compte des anomalies faibles", () => {
  // Catalogue complet mais sans aucun SKU : score < 100, sans être catastrophique.
  const c = E.parseCSV("ID,Type,SKU,Name,Regular price,Description,Categories,Images\n1,simple,,A,10,Desc,Cat,https://x.test/1.jpg\n2,simple,,B,12,Desc,Cat,https://x.test/2.jpg\n");
  const r = E.analyze(c, {});
  assert.equal(r.stats.score, 85);
  const clean = E.analyze(E.parseCSV("ID,Type,SKU,Name,Regular price,Description,Categories,Images\n1,simple,S1,A,10,Desc,Cat,https://x.test/1.jpg\n"), {});
  assert.equal(clean.stats.score, 100);
});

test("1.7.2 : en-tête du CSV corrigé lisible par l'import WooCommerce", () => {
  const c = fixture("woocommerce-fr-theme-span.csv");
  const out = E.buildCorrectedCSV(c, [], []);
  // Le BOM ne doit pas être suivi d'un guillemet, sinon WooCommerce lit « "ID" » et ignore la colonne.
  assert.ok(out.startsWith("﻿ID;Type;UGS;"), out.slice(0, 30));
  // Les champs qui l'exigent restent entre guillemets, et le fichier se relit à l'identique.
  const again = E.parseCSV(out);
  assert.deepEqual(again.rows, c.rows);
  assert.deepEqual(again.headers, c.headers);
  // Fichier séparé par des virgules : une valeur contenant une virgule doit rester entre guillemets.
  const en = fixture("woocommerce-en-parent-sku.csv");
  const outEn = E.buildCorrectedCSV(en, [], []);
  assert.ok(outEn.startsWith("\uFEFFID,Type,SKU,"));
  assert.ok(outEn.includes(',"S, M, L, XL",'));
  assert.deepEqual(E.parseCSV(outEn).rows, en.rows);
});

test("rapport d’audit : anomalies regroupées par conséquence et données échappées", () => {
  const catalog = E.parseCSV('ID,Type,SKU,Name,Regular price,Images,Categories,Description\n1,simple,,"<script>alert(1)</script>",10,"a.jpg, a.jpg",Robes,Texte\n2,simple,,Jupe,,b.jpg,Robes,Texte\n');
  const r = E.analyze(catalog, {});
  const html = E.buildAuditReportHTML(r, { store: "Boutique <b>", source: "test.csv", date: "2026-10-24" });
  assert.ok(!html.includes("<script>alert"), "nom de produit échappé");
  assert.ok(!/<b>/.test(html.replace(/<\/?(body|br)>/g, "")), "aucune balise venant des données");
  assert.ok(html.includes("Boutique &lt;b&gt;"));
  assert.match(html, /Peut faire perdre des ventes <span class="n">1<\/span>/); // prix absent sur Jupe
  assert.match(html, /Prix absent/);
  assert.match(html, /Même image répétée/);
  assert.match(html, /Audit du 2026-10-24/);
});

test("GTIN : longueur, clé de contrôle, plages réservées et coupons", () => {
  assert.equal(E.gtinProblem(""), null);
  assert.equal(E.gtinProblem("4006381333931"), null, "EAN-13 valide");
  assert.equal(E.gtinProblem("036000291452"), null, "UPC-A valide");
  assert.equal(E.gtinProblem("4006 3813 3393 1"), null, "espaces ignorés");
  assert.match(E.gtinProblem("4006381333932"), /clé de contrôle/);
  assert.match(E.gtinProblem("12345"), /5 chiffres/);
  assert.match(E.gtinProblem("2000000000008"), /usage interne/);
  assert.match(E.gtinProblem("0-306-40615-2"), /ISBN à 10 chiffres/);
  assert.match(E.gtinProblem("ABC1234567890"), /autre chose que des chiffres/);
});

test("GTIN : invalide et doublon signalés, absent seulement si le catalogue en utilise", () => {
  const head = "ID,Type,SKU,Name,Regular price,Categories,Description,\"GTIN, UPC, EAN, or ISBN\"\n";
  const r = E.analyze(E.parseCSV(head + "1,simple,A,Robe,10,Robes,Texte,4006381333931\n2,simple,B,Jupe,10,Robes,Texte,4006381333931\n3,simple,C,Top,10,Robes,Texte,4006381333932\n4,simple,D,Short,10,Robes,Texte,\n"), {});
  assert.deepEqual(r.issues.filter(i => i.code.startsWith("GTIN")).map(i => `${i.productId}:${i.code}`), ["2:GTIN_DUPLICATE", "3:GTIN_INVALID", "4:GTIN_MISSING"]);
  assert.ok(!r.proposals.some(p => p.col === 7), "aucun GTIN proposé : il ne s’invente pas");
  const none = E.analyze(E.parseCSV(head + "1,simple,A,Robe,10,Robes,Texte,\n2,simple,B,Jupe,10,Robes,Texte,\n"), {});
  assert.ok(!none.issues.some(i => i.code.startsWith("GTIN")), "marque propre sans GTIN : aucune alerte");
});

test("images : taille mesurée (seuils Google), image cassée, sans mesure aucune alerte", () => {
  const csv = "ID,Type,SKU,Name,Regular price,Categories,Description,Images\n1,simple,A,Robe,10,Robes,Texte,https://x.test/a.jpg\n2,simple,B,Jupe,10,Robes,Texte,https://x.test/b.jpg\n3,simple,C,Top,10,Robes,Texte,https://x.test/c.jpg\n4,simple,D,Short,10,Robes,Texte,https://x.test/d.jpg\n";
  const plain = E.analyze(E.parseCSV(csv), {});
  assert.ok(!plain.issues.some(i => i.code.startsWith("IMAGE")));
  const c = E.parseCSV(csv);
  c.imageSizes = { "https://x.test/a.jpg": { width: 200, height: 300 }, "https://x.test/b.jpg": { width: 800, height: 400 }, "https://x.test/c.jpg": { broken: true }, "https://x.test/d.jpg": { width: 1000, height: 1000 } };
  const r = E.analyze(c, {});
  assert.deepEqual(r.issues.filter(i => i.code.startsWith("IMAGE")).map(i => `${i.productId}:${i.code}`), ["1:IMAGE_TOO_SMALL", "2:IMAGE_BELOW_500", "3:IMAGE_BROKEN"]);
  assert.match(r.issues.find(i => i.code === "IMAGE_TOO_SMALL").message, /200 × 300 px/);
  const html = E.buildAuditReportHTML(r, { date: "2026-10-24" });
  assert.match(html, /Visibilité sur Google <span class="n">2<\/span>/);
});

test("noms : entités HTML de WordPress décodées (tiret, apostrophe)", () => {
  const c = E.catalogFromRows(["ID", "Type", "Name", "Regular price"], [["1", "simple", "Aurea Fides &#8211; 1ml", "0"], ["2", "simple", "L&rsquo;eau &amp; co &#x2014; 5ml", "0"]], [2, 3], ",");
  const names = E.analyze(c).issues.map(i => i.product);
  assert.ok(names.includes("Aurea Fides – 1ml"), names.join(" | "));
  assert.ok(names.includes("L’eau & co — 5ml"), names.join(" | "));
});

test("prospectSummary : exemple pris dans « ventes » d’abord, faibles ignorées", () => {
  const result = { issues: [
    { row: 1, code: "IMAGE_ALT_MISSING", severity: E.SEVERITY.LOW, product: "A", message: "alt" },
    { row: 2, code: "GTIN_INVALID", severity: E.SEVERITY.MEDIUM, product: "B", message: "gtin" },
    { row: 3, code: "PRICE_NON_POSITIVE", severity: E.SEVERITY.HIGH, product: "Baskets", productId: "9", message: "Prix nul ou négatif" },
    { row: -1, code: "PRICE_COLUMN_MISSING", severity: E.SEVERITY.HIGH, product: "", message: "structure" }
  ] };
  const s = E.prospectSummary(result);
  assert.equal(s.serious, 2);
  assert.equal(s.counts.sales, 1);
  assert.equal(s.counts.google, 1);
  assert.equal(s.example.product, "Baskets");
  assert.equal(E.prospectSummary({ issues: [result.issues[0]] }).example, null);
});

test("prospectSummary : un nom en double ne fait pas une accroche", () => {
  const s = E.prospectSummary({ issues: [{ row: 1, code: "NAME_DUPLICATE", severity: E.SEVERITY.MEDIUM, product: "Belt", message: "Nom en double" }] });
  assert.equal(s.serious, 0);
  assert.equal(s.counts.trust, 0);
  assert.equal(s.example, null);
});

test("rapport en marque blanche : nom et couleur de l’agence, aucune mention de WayPilot", () => {
  const r = E.analyze(E.parseCSV("ID,Type,SKU,Name,Regular price,Categories,Description\n1,simple,A,Robe,,Robes,Texte\n"), {});
  const html = E.buildAuditReportHTML(r, { date: "2026-10-24", brand: { name: "Agence <Lumière>", color: "#0a7f5a" } });
  assert.ok(!/WayPilot/i.test(html), "WayPilot absent");
  assert.ok(html.includes("Agence &lt;Lumière&gt;"));
  assert.ok(html.includes("solid #0a7f5a"));
  const bad = E.buildAuditReportHTML(r, { brand: { name: "X", color: "red;}</style><script>" } });
  assert.ok(!bad.includes("<script>") && bad.includes("solid #1769ff"), "couleur invalide ignorée");
  assert.match(E.buildAuditReportHTML(r, {}), /Way<span>Pilot<\/span>/);
});

test("durée d’audit : format lisible et reprise dans le rapport", () => {
  assert.equal(E.formatDuration(0.4), "1 s");
  assert.equal(E.formatDuration(14.2), "14 s");
  assert.equal(E.formatDuration(125), "2 min 05 s");
  const r = E.analyze(E.parseCSV("ID,Type,SKU,Name,Regular price\n1,simple,A,Robe,10\n"), {});
  assert.match(E.buildAuditReportHTML(r, { date: "2026-10-24", seconds: 14 }), /Audit du 2026-10-24 · réalisé en 14 s/);
  assert.ok(!/réalisé en/.test(E.buildAuditReportHTML(r, { date: "2026-10-24" })));
});

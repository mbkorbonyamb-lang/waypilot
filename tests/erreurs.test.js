// Lancer avec : node --test tests/erreurs.test.js
// Suivi des erreurs (erreurs.js) : rien de personnel ne part vers Sentry.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../erreurs.js");

test("e-mails, téléphones, jetons et boutiques masqués", () => {
  const s = R.scrubText("Échec sur https://www.maboutique.fr/wp-json/wc/store?x=1 pour contact@maboutique.fr, tél 06 12 34 56 78, lien /r/AbCdEf123456, clé a1B2c3D4e5F6g7H8i9J0k1L2m3");
  assert.doesNotMatch(s, /maboutique|contact@|12 34 56|AbCdEf123456|a1B2c3D4e5F6g7H8i9J0k1L2m3/);
  assert.match(s, /\[adresse\]/);
  assert.match(s, /\[e-mail\]/);
  assert.match(s, /\[téléphone\]/);
  assert.match(s, /\/r\/\[jeton\]/);
});

test("domaine seul d'une boutique masqué, adresses WayPilot gardées", () => {
  assert.equal(R.scrubText("Lecture de boutique-exemple.com impossible"), "Lecture de [boutique] impossible");
  assert.equal(R.scrubText("Relais https://waypilot-relais.wayzure.workers.dev/products?u=x en panne"), "Relais https://waypilot-relais.wayzure.workers.dev/products en panne");
  assert.equal(R.scrubText("TypeError: x is undefined in engine.js"), "TypeError: x is undefined in engine.js");
});

test("événement : utilisateur, en-têtes, paramètres et console retirés", () => {
  const e = R.scrubEvent({
    user: { ip_address: "1.2.3.4" },
    request: { url: "https://waypilot.wayzure.com/app?boutique=x.fr", headers: { "User-Agent": "x" } },
    exception: { values: [{ type: "Error", value: "Audit de https://shop.client.ch échoué" }] },
    breadcrumbs: [{ category: "console", message: "client@x.fr" }, { category: "fetch", data: { url: "https://shop.client.ch/products.json?page=2", method: "GET" } }],
    contexts: { browser: { name: "Chrome" } },
  });
  assert.equal(e.user, undefined);
  assert.deepEqual(e.request, { url: "https://waypilot.wayzure.com/app" });
  assert.equal(e.exception.values[0].value, "Audit de [adresse] échoué");
  assert.equal(e.breadcrumbs.length, 1);
  assert.deepEqual(e.breadcrumbs[0].data, { url: "[adresse]", method: "GET" });
  assert.deepEqual(e.contexts.browser, { name: "Chrome" });
});

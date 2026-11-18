/*
 * WayPilot : suivi des erreurs du navigateur (Sentry, plan gratuit).
 *
 * Rien n'est téléchargé tant qu'aucune erreur ne survient : le module Sentry (sentry.min.js, hébergé ici,
 * aucun appel à un site tiers) n'est chargé qu'à la première erreur, qui est alors envoyée.
 * Sans adresse DSN (posée à la publication depuis la variable de dépôt SENTRY_DSN), rien n'est chargé ni envoyé.
 *
 * Aucune donnée personnelle : avant l'envoi, adresse IP, utilisateur, en-têtes et paramètres d'adresse sont retirés ;
 * e-mails, téléphones, jetons et adresses des boutiques auditées sont masqués ; traces de console supprimées.
 * Pas de vidéo de session, pas de mesure de performance, pas de suivi de session.
 *
 * Fonctionne dans le navigateur et dans Node (module.exports) pour les tests.
 */
(function () {
  "use strict";

  // Remplacé à la publication (étape « Préparer le site » du workflow). Laissé tel quel : suivi coupé.
  var DSN = "__SENTRY_DSN__";

  var EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var PHONE = /(?:\+|\b00|\b0)[\d\s().-]{7,}\d/g;
  var TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
  // Liens de rapport envoyés aux prospects : /r/<id>.
  var TOKEN_PATH = /\/r\/[A-Za-z0-9]+/g;
  // Adresses des boutiques auditées (ce sont nos prospects) ; celles de WayPilot restent lisibles.
  var URL_RE = /\bhttps?:\/\/[^\s"'<>)]+/gi;
  var HOST_RE = /\b(?:[a-z0-9-]+\.)+(?:fr|com|net|org|be|ch|lu|ca|eu|shop|store|boutique|co|io|biz|info|online|site)\b/gi;
  var OWN = /(^|\.)(wayzure\.com|waypilot\.pages\.dev|workers\.dev|hf\.space|huggingface\.co)$/i;

  function isOwn(host) { return OWN.test(String(host).toLowerCase()); }

  function scrubText(s) {
    return String(s)
      .replace(EMAIL, "[e-mail]")
      .replace(URL_RE, function (u) {
        var m = /^https?:\/\/([^/?#:]+)/i.exec(u);
        return m && isOwn(m[1]) ? u.split(/[?#]/)[0].replace(TOKEN_PATH, "/r/[jeton]") : "[adresse]";
      })
      .replace(HOST_RE, function (h) { return isOwn(h) ? h : "[boutique]"; })
      .replace(TOKEN_PATH, "/r/[jeton]")
      .replace(TOKEN, "[jeton]")
      .replace(PHONE, "[téléphone]");
  }

  function scrubUrl(u) { return scrubText(String(u).split(/[?#]/)[0]); }

  function scrubDeep(v, depth) {
    depth = depth || 0;
    if (typeof v === "string") return scrubText(v);
    if (depth > 6 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(function (x) { return scrubDeep(x, depth + 1); });
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = scrubDeep(v[k], depth + 1); });
    return out;
  }

  function scrubBreadcrumb(b) {
    if (!b || b.category === "console") return null;
    var out = Object.assign({}, b);
    if (typeof out.message === "string") out.message = scrubText(out.message);
    if (out.data) {
      var data = {};
      Object.keys(out.data).forEach(function (k) {
        var x = out.data[k];
        data[k] = (k === "url" || k === "from" || k === "to") && typeof x === "string" ? scrubUrl(x) : scrubDeep(x);
      });
      out.data = data;
    }
    return out;
  }

  var SAFE_CONTEXTS = ["browser", "os", "device", "runtime", "app", "culture", "trace"];

  function scrubEvent(e) {
    delete e.user;
    delete e.server_name;
    if (e.request) e.request = e.request.url ? { url: scrubUrl(e.request.url) } : {};
    if (typeof e.message === "string") e.message = scrubText(e.message);
    if (e.logentry) e.logentry = { message: e.logentry.message ? scrubText(e.logentry.message) : undefined };
    ((e.exception && e.exception.values) || []).forEach(function (x) { if (typeof x.value === "string") x.value = scrubText(x.value); });
    if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
    if (e.extra) e.extra = scrubDeep(e.extra);
    if (e.tags) e.tags = scrubDeep(e.tags);
    if (e.contexts) {
      var c = Object.assign({}, e.contexts);
      Object.keys(c).forEach(function (k) { if (SAFE_CONTEXTS.indexOf(k) < 0) c[k] = scrubDeep(c[k]); });
      e.contexts = c;
    }
    if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction);
    return e;
  }

  var api = { scrubText: scrubText, scrubUrl: scrubUrl, scrubEvent: scrubEvent, scrubBreadcrumb: scrubBreadcrumb };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  if (typeof window === "undefined" || !DSN || DSN.indexOf("__") === 0) return;

  var pending = [], loading = false, ready = false;

  function start() {
    var S = window.WaypilotSentry;
    if (!S) return;
    var I = S.integrations;
    S.init({
      dsn: DSN,
      environment: /(^|\.)wayzure\.com$/.test(location.hostname) ? "production" : "preview",
      sendDefaultPii: false,
      defaultIntegrations: false,
      // Erreurs seulement : ni suivi de session (adresse IP), ni performance, ni vidéo.
      integrations: [I.browserApiErrorsIntegration(), I.globalHandlersIntegration(), I.linkedErrorsIntegration(), I.dedupeIntegration(), I.httpContextIntegration(), I.breadcrumbsIntegration({ console: false, dom: true, fetch: true, xhr: true, history: true })],
      maxBreadcrumbs: 30,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb
    });
    ready = true;
    pending.splice(0).forEach(function (err) { S.captureException(err); });
  }

  function capture(err) {
    if (ready) return; // Sentry écoute déjà lui-même les erreurs suivantes
    if (pending.length < 20) pending.push(err);
    if (loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = "sentry.min.js";
    s.async = true;
    s.onload = start;
    document.head.appendChild(s);
  }

  window.addEventListener("error", function (e) {
    // Fichier (image, script) introuvable : pas une erreur du code.
    if (!e.error && !e.message) return;
    capture(e.error || new Error(e.message));
  });
  window.addEventListener("unhandledrejection", function (e) { capture(e.reason instanceof Error ? e.reason : new Error(String(e.reason))); });
})();

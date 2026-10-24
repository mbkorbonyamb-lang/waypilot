/*
 * WayPilot — connexion directe WooCommerce (API REST v3).
 * Lit le catalogue (produits + variations), le convertit au format du moteur,
 * puis applique les corrections validées par lots. Les clés restent en mémoire,
 * dans le navigateur : elles ne sont ni enregistrées ni envoyées ailleurs que sur la boutique.
 */
(function (root) {
  "use strict";

  const BATCH_SIZE = 100;
  const clean = v => String(v ?? "").trim();

  // ---------- Adresse de la boutique ----------

  function normalizeStoreUrl(raw) {
    let s = clean(raw);
    if (!s) throw new Error("Indiquez l’adresse de la boutique.");
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    let u;
    try { u = new URL(s); } catch (_) { throw new Error("Adresse de boutique invalide."); }
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if (u.protocol !== "https:" && !local) throw new Error("La boutique doit être en HTTPS : les clés ne doivent pas circuler en clair.");
    return (u.origin + u.pathname).replace(/\/+$/, "").replace(/\/wp-json(\/.*)?$/, "");
  }

  // ---------- Client HTTP ----------

  /**
   * Authentification par paramètres consumer_key / consumer_secret (HTTPS) :
   * pas d’en-tête Authorization, souvent supprimé par les hébergeurs.
   */
  function createClient({ url, key, secret, fetchImpl }) {
    const site = normalizeStoreUrl(url);
    if (!/^ck_/.test(clean(key)) || !/^cs_/.test(clean(secret))) throw new Error("La clé doit commencer par ck_ et le secret par cs_.");
    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    if (!doFetch) throw new Error("fetch indisponible.");
    let mode = "pretty"; // /wp-json/... ; sinon ?rest_route=... (permaliens simples)

    const buildUrl = (path, query) => {
      const params = new URLSearchParams({ ...query, consumer_key: clean(key), consumer_secret: clean(secret) });
      return mode === "pretty"
        ? `${site}/wp-json/wc/v3${path}?${params}`
        : `${site}/?rest_route=${encodeURIComponent("/wc/v3" + path)}&${params}`;
    };

    async function send(method, path, { query = {}, body } = {}) {
      let res;
      try {
        res = await doFetch(buildUrl(path, query), {
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
          credentials: "omit"
        });
      } catch (_) {
        throw new Error("La boutique n’a pas répondu ou le navigateur a bloqué la connexion (CORS, pare-feu ou extension de sécurité).");
      }
      let data = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      if (!res.ok) {
        const msg = data && data.message ? data.message : `HTTP ${res.status}`;
        const err = new Error(
          res.status === 401 || res.status === 403 ? `Accès refusé par la boutique : ${msg}. Vérifiez la clé, le secret et les droits (Lecture/Écriture).`
            : res.status === 404 ? "API WooCommerce introuvable à cette adresse."
              : `Erreur de la boutique : ${msg}`);
        err.status = res.status;
        throw err;
      }
      if (data === null) {
        const err = new Error("Réponse inattendue de la boutique (pas du JSON). Une page de cache ou de sécurité s’intercale peut-être.");
        err.status = res.status;
        throw err;
      }
      return { data, totalPages: Number(res.headers && res.headers.get ? res.headers.get("X-WP-TotalPages") : 0) || 0 };
    }

    async function request(method, path, opts) {
      try { return await send(method, path, opts); }
      catch (e) {
        // Permaliens « simples » : /wp-json/ n’existe pas, rest_route fonctionne.
        if (mode === "pretty" && (e.status === 404 || (e.status && e.status < 300))) { mode = "plain"; return send(method, path, opts); }
        throw e;
      }
    }

    async function getAll(path, onPage) {
      const all = [];
      for (let page = 1; ; page++) {
        const { data, totalPages } = await request("GET", path, { query: { per_page: "100", page: String(page) } });
        if (!Array.isArray(data)) throw new Error("Réponse inattendue de la boutique.");
        all.push(...data);
        if (onPage) onPage(all.length);
        if (data.length < 100 || (totalPages && page >= totalPages)) break;
      }
      return all;
    }

    /** Produits (tous statuts) et variations des produits variables. */
    async function fetchCatalog(onProgress = () => {}) {
      const products = await getAll("/products", n => onProgress(`${n} produits lus…`));
      const variations = {};
      const variable = products.filter(p => p.type === "variable");
      for (let i = 0; i < variable.length; i++) {
        onProgress(`Variations : produit ${i + 1}/${variable.length}…`);
        variations[variable[i].id] = await getAll(`/products/${variable[i].id}/variations`);
      }
      return { products, variations };
    }

    /** Applique un plan construit par buildChanges. Renvoie une ligne de résultat par élément. */
    async function applyChanges(plan, onProgress = () => {}) {
      const results = [];
      const run = async (path, kind, items) => {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const chunk = items.slice(i, i + BATCH_SIZE);
          let data;
          try { ({ data } = await request("POST", path, { body: { [kind]: chunk.map(c => c.payload) } })); }
          catch (e) { chunk.forEach(c => results.push({ label: c.label, ok: false, error: e.message, item: c, kind })); continue; }
          const answers = (data && data[kind]) || [];
          chunk.forEach((c, j) => {
            const a = answers[j];
            const error = !a ? "Pas de réponse pour cet élément." : a.error ? (a.error.message || a.error.code) : "";
            results.push({ label: c.label, ok: !error, error, id: a && a.id, item: c, kind });
          });
          onProgress(results.length);
        }
      };
      await run("/products/batch", "update", plan.products);
      for (const [parentId, v] of Object.entries(plan.variations)) {
        // Suppressions d’abord : les doublons ne gênent plus les UGS des variations gardées.
        await run(`/products/${parentId}/variations/batch`, "delete", v.delete || []);
        await run(`/products/${parentId}/variations/batch`, "update", v.update);
        await run(`/products/${parentId}/variations/batch`, "create", v.create);
      }
      return results;
    }

    return { site, fetchCatalog, applyChanges, request };
  }

  // ---------- Conversion API → catalogue du moteur ----------

  const PUBLISHED = { publish: "1", private: "-1", draft: "0", pending: "0", future: "0" };
  const IN_STOCK = { instock: "1", outofstock: "0", onbackorder: "backorder" };
  const joinNames = list => (list || []).map(x => x.name).filter(Boolean).join(", ");

  // GTIN : champ natif global_unique_id (WooCommerce 9.2 et plus), sinon champ d’une extension EAN/GTIN.
  const GTIN_META = /(^|_)(gtin|ean|upc|isbn)(_|$)|gtin/i;
  const gtinOf = x => {
    if (clean(x.global_unique_id)) return clean(x.global_unique_id);
    const m = (x.meta_data || []).find(d => GTIN_META.test(d.key || "") && typeof d.value === "string" && /\d/.test(d.value));
    return m ? clean(m.value) : "";
  };
  const hasGtinField = x => "global_unique_id" in x || !!gtinOf(x);
  const altOf = list => list.filter(i => i && i.src).map(i => ({ src: i.src, alt: clean(i.alt) }));

  /**
   * Construit un catalogue au format CSV WooCommerce (en-têtes anglais) à partir des réponses de l’API.
   * catalog.meta[i] garde ce qu’il faut pour écrire les corrections : id, parent, images, attributs.
   */
  function toCatalog(engine, { products, variations }) {
    const parents = products.filter(p => p.type !== "variation");
    const maxAttrs = Math.max(1, ...parents.map(p => (p.attributes || []).length));
    const headers = ["ID", "Type", "SKU", "Name", "Published", "Short description", "Description", "Sale price", "Regular price", "Categories", "Images", "Parent", "In stock?", "Manage stock?", "Stock"];
    // Colonne GTIN seulement si la boutique expose ce champ : sinon, aucun contrôle GTIN (pas de fausse alerte).
    const withGtin = products.some(hasGtinField) || Object.values(variations).some(l => l.some(hasGtinField));
    if (withGtin) headers.push("GTIN, UPC, EAN, or ISBN");
    const gtinCells = x => (withGtin ? [gtinOf(x)] : []);
    const imageAlt = [];
    for (let n = 1; n <= maxAttrs; n++) headers.push(`Attribute ${n} name`, `Attribute ${n} value(s)`, `Attribute ${n} visible`, `Attribute ${n} global`);
    const rows = [], meta = [];
    const stockCells = x => {
      const managed = x.manage_stock === true;
      return [IN_STOCK[x.stock_status] ?? clean(x.stock_status), managed ? "1" : "0", managed && x.stock_quantity !== null && x.stock_quantity !== undefined ? String(x.stock_quantity) : ""];
    };

    parents.forEach(p => {
      const attrs = p.attributes || [];
      const row = [String(p.id), p.type, clean(p.sku), clean(p.name), PUBLISHED[p.status] ?? "0", p.short_description || "", p.description || "",
        clean(p.sale_price), clean(p.regular_price), joinNames(p.categories), (p.images || []).map(i => i.src).join(", "), "", ...stockCells(p), ...gtinCells(p)];
      for (let n = 0; n < maxAttrs; n++) {
        const a = attrs[n];
        row.push(a ? a.name : "", a ? (a.options || []).join(", ") : "", a ? (a.visible ? "1" : "0") : "", a ? (a.id ? "1" : "0") : "");
      }
      rows.push(row);
      imageAlt.push(altOf(p.images || []));
      meta.push({ kind: "product", id: p.id, sku: clean(p.sku), regularPrice: clean(p.regular_price), images: (p.images || []).map(i => ({ id: i.id, src: i.src })), attributes: attrs });

      // Ordre croissant des ID : en cas de doublon, la variation d’origine sert de référence.
      (variations[p.id] || []).slice().sort((a, b) => a.id - b.id).forEach(v => {
        const vAttrs = v.attributes || [];
        const optionFor = a => {
          const m = vAttrs.find(x => (a.id && x.id === a.id) || (!a.id && clean(x.name).toLowerCase() === clean(a.name).toLowerCase()));
          return m ? clean(m.option) : "";
        };
        const options = attrs.map(optionFor).filter(Boolean);
        const vrow = [String(v.id), "variation", clean(v.sku), `${clean(p.name)}${options.length ? " - " + options.join(", ") : ""}`, PUBLISHED[v.status] ?? "0",
          "", v.description || "", clean(v.sale_price), clean(v.regular_price), "", v.image && v.image.src ? v.image.src : "", `id:${p.id}`, ...stockCells(v), ...gtinCells(v)];
        for (let n = 0; n < maxAttrs; n++) {
          const a = attrs[n];
          vrow.push(a ? a.name : "", a ? optionFor(a) : "", "", a ? (a.id ? "1" : "0") : "");
        }
        rows.push(vrow);
        imageAlt.push(altOf(v.image ? [v.image] : []));
        meta.push({ kind: "variation", id: v.id, parentId: p.id, sku: clean(v.sku), regularPrice: clean(v.regular_price), attributes: vAttrs, parentAttributes: attrs });
      });
    });

    const catalog = engine.catalogFromRows(headers, rows, rows.map((_, i) => i + 2), ",");
    catalog.meta = meta;
    catalog.imageAlt = imageAlt;
    catalog.source = "woocommerce";
    return catalog;
  }

  // ---------- Corrections validées → requêtes ----------

  /**
   * Regroupe les propositions validées et les variations validées par produit.
   * Renvoie { products: [{label, payload}], variations: {parentId: {update, create}}, skipped: [{label, reason}] }.
   */
  function buildChanges(catalog, proposals, manualVariations = []) {
    const { meta } = catalog;
    if (!meta) throw new Error("Ce catalogue ne vient pas de la connexion WooCommerce.");
    const productUpd = new Map(), variationUpd = new Map(), skipped = [];
    const variations = {};
    const slot = pid => (variations[pid] = variations[pid] || { update: [], create: [], delete: [] });
    const deleted = new Set(proposals.filter(p => p.status === "approved" && p.kind === "deleteVariation").map(p => p.row));
    const labelOf = p => `${p.product} (ID ${meta[p.row].id})`;
    const entry = (m, label) => {
      const map = m.kind === "product" ? productUpd : variationUpd;
      if (!map.has(m.id)) map.set(m.id, { label, payload: { id: m.id }, undo: { id: m.id }, changes: [], parentId: m.parentId, parts: [] });
      return map.get(m.id);
    };

    proposals.filter(p => p.status === "approved").forEach(p => {
      const m = meta[p.row];
      if (!m) return;
      if (p.kind === "deleteVariation") {
        if (m.kind === "variation") slot(m.parentId).delete.push({
          label: `${labelOf(p)} : suppression du doublon`, payload: m.id, parentId: m.parentId, undo: null,
          changes: [{ field: "variation", before: p.before, after: "supprimée" }]
        });
        return;
      }
      if (deleted.has(p.row)) return; // inutile de corriger une variation supprimée
      const e = entry(m, labelOf(p));
      if (p.kind === "sku") {
        e.payload.sku = clean(p.after); e.undo.sku = m.sku; e.parts.push(`UGS ${clean(p.after)}`);
        e.changes.push({ field: "UGS", before: m.sku, after: clean(p.after) });
      } else if (p.kind === "priceRegular") {
        e.payload.regular_price = clean(p.after); e.undo.regular_price = m.regularPrice; e.parts.push(`prix ${clean(p.after)}`);
        e.changes.push({ field: "prix régulier", before: m.regularPrice, after: clean(p.after) });
      }
      else if (p.kind === "images" && m.kind === "product") {
        const seen = new Set(), keep = [];
        const wanted = new Set(String(p.after).split(/\s*,\s*/).map(clean).filter(Boolean));
        m.images.forEach(img => { if (wanted.has(img.src) && !seen.has(img.src)) { seen.add(img.src); keep.push({ id: img.id }); } });
        if (!keep.length) { skipped.push({ label: labelOf(p), reason: "images : aucune image reconnue, rien n’est envoyé" }); return; }
        e.payload.images = keep; e.undo.images = m.images.map(img => ({ id: img.id })); e.parts.push(`${keep.length} image(s) sans doublon`);
        e.changes.push({ field: "images", before: m.images.map(img => img.src).join(", "), after: String(p.after) });
      } else if (p.kind === "attributeValue" && m.kind === "variation") {
        const a = catalog.attrCols.find(x => x.valueCol === p.col);
        const pa = a && m.parentAttributes[a.n - 1];
        if (!pa) { skipped.push({ label: labelOf(p), reason: "attribut introuvable" }); return; }
        const current = e.payload.attributes || m.attributes.map(x => ({ ...(x.id ? { id: x.id } : { name: x.name }), option: x.option }));
        const same = x => (pa.id && x.id === pa.id) || (!pa.id && clean(x.name).toLowerCase() === clean(pa.name).toLowerCase());
        const next = current.filter(x => !same(x));
        next.push({ ...(pa.id ? { id: pa.id } : { name: pa.name }), option: clean(p.after) });
        e.payload.attributes = next; e.parts.push(`${pa.name} = ${clean(p.after)}`);
        if (!e.undo.attributes) e.undo.attributes = m.attributes.map(x => ({ ...(x.id ? { id: x.id } : { name: x.name }), option: x.option }));
        e.changes.push({ field: pa.name, before: p.before, after: clean(p.after) });
      } else {
        skipped.push({ label: labelOf(p), reason: `correction « ${p.label} » non prise en charge par la connexion directe` });
      }
    });

    manualVariations.filter(v => v.validated && v.selected).forEach(v => {
      const m = meta[v.parentRow];
      const label = `${v.name} (nouvelle variation du produit ${m ? m.id : "?"})`;
      if (!m || m.kind !== "product") { skipped.push({ label, reason: "produit parent introuvable" }); return; }
      const pa = m.attributes[v.attributeNumber - 1];
      if (!pa) { skipped.push({ label, reason: "attribut du parent introuvable" }); return; }
      const payload = {
        regular_price: clean(v.price),
        status: v.enabled ? "publish" : "private",
        attributes: [{ ...(pa.id ? { id: pa.id } : { name: pa.name }), option: v.attributeValue }]
      };
      if (clean(v.sku)) payload.sku = clean(v.sku);
      if (clean(v.stockQty) !== "") { payload.manage_stock = true; payload.stock_quantity = Number(v.stockQty); }
      slot(m.id).create.push({ label, payload, parentId: m.id, undo: "deleteCreated",
        changes: [{ field: "variation", before: "(absente)", after: `${pa.name} ${v.attributeValue}, prix ${clean(v.price)}` }] });
      // Sans « Utilisé pour les variations », la variation créée ne serait pas commandable.
      if (!pa.variation) {
        const e = entry(m, `${v.parentName} (ID ${m.id})`);
        if (!e.payload.attributes) {
          e.payload.attributes = m.attributes.map(a => ({ ...(a.id ? { id: a.id } : { name: a.name }), position: a.position, visible: a.visible, variation: a.variation, options: a.options }));
        }
        const target = e.payload.attributes.find(a => (pa.id && a.id === pa.id) || (!pa.id && a.name === pa.name));
        if (target && !target.variation) {
          target.variation = true; e.parts.push(`« ${pa.name} » utilisé pour les variations`);
          if (!e.undo.attributes) e.undo.attributes = m.attributes.map(a => ({ ...(a.id ? { id: a.id } : { name: a.name }), position: a.position, visible: a.visible, variation: a.variation, options: a.options }));
          e.changes.push({ field: `${pa.name} : utilisé pour les variations`, before: "non", after: "oui" });
        }
      }
    });

    const finish = e => ({ label: `${e.label} : ${e.parts.join(", ")}`, payload: e.payload, undo: e.undo, changes: e.changes, parentId: e.parentId });
    const products = [...productUpd.values()].map(finish);
    variationUpd.forEach(e => slot(e.parentId).update.push(finish(e)));
    const count = products.length + Object.values(variations).reduce((s, v) => s + v.update.length + v.create.length + v.delete.length, 0);
    return { products, variations, skipped, count };
  }

  // ---------- Journal et retour arrière ----------

  const csvCell = v => {
    let t = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; // pas de formule à l’ouverture dans un tableur
    return '"' + t.replace(/"/g, '""') + '"';
  };

  /** Journal des modifications envoyées : une ligne par champ, avec avant / après et résultat. */
  function buildJournalCSV(results, { site = "", date = new Date().toISOString() } = {}) {
    const head = ["Date", "Boutique", "Élément", "Champ", "Avant", "Après", "Résultat"];
    const lines = [head.map(csvCell).join(";")];
    results.forEach(r => {
      const changes = r.item && r.item.changes && r.item.changes.length ? r.item.changes : [{ field: "", before: "", after: "" }];
      changes.forEach(c => lines.push([date, site, r.label, c.field, c.before, c.after, r.ok ? "Appliquée" : `Échec : ${r.error}`].map(csvCell).join(";")));
    });
    return "\uFEFF" + lines.join("\r\n");
  }

  /**
   * Plan inverse des modifications réussies : anciennes valeurs pour les mises à jour,
   * suppression des variations créées. Les suppressions ne sont pas réversibles (sauvegarde).
   */
  function buildRollback(results) {
    const products = [], variations = {}, notReversible = [];
    const slot = pid => (variations[pid] = variations[pid] || { update: [], create: [], delete: [] });
    results.filter(r => r.ok && r.item).forEach(r => {
      const { item, kind } = r;
      const label = `Annulation : ${r.label}`;
      if (kind === "delete") notReversible.push(r.label);
      else if (kind === "create") { if (r.id) slot(item.parentId).delete.push({ label, payload: r.id, parentId: item.parentId }); }
      else if (item.parentId) slot(item.parentId).update.push({ label, payload: item.undo, parentId: item.parentId });
      else products.push({ label, payload: item.undo });
    });
    const count = products.length + Object.values(variations).reduce((s, v) => s + v.update.length + v.delete.length, 0);
    return { products, variations, skipped: [], count, notReversible };
  }

  const api = { normalizeStoreUrl, createClient, toCatalog, buildChanges, buildJournalCSV, buildRollback };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WayPilotWoo = api;
})(typeof window !== "undefined" ? window : globalThis);

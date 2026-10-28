/*
 * WayPilot — audit express des boutiques Shopify.
 * Lecture seule, sans clé : Shopify publie le catalogue de chaque boutique en JSON (/products.json),
 * produits publiés, variantes et images, tel que les clients le voient. La lecture passe par le relais
 * WayPilot (CORS), qui ne reçoit que l’adresse de la boutique. Aucune correction n’est écrite.
 */
(function (root) {
  "use strict";

  const PAGE_SIZE = 250;   // maximum accepté par /products.json
  const MAX_PAGES = 100;   // 25 000 produits : garde-fou si une boutique renvoie toujours la même page
  const clean = v => String(v ?? "").trim();

  function normalizeHost(raw) {
    let s = clean(raw);
    if (!s) throw new Error("Indiquez l’adresse de la boutique.");
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try { return new URL(s).host.toLowerCase(); } catch (_) { throw new Error("Adresse de boutique invalide."); }
  }

  function createShopifyClient({ url, relay, fetchImpl }) {
    const host = normalizeHost(url);
    const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(root) : null);
    if (!doFetch) throw new Error("fetch indisponible.");

    async function page(n) {
      let res;
      try {
        res = await doFetch(`${relay.replace(/\/+$/, "")}/shopify?${new URLSearchParams({ site: host, page: String(n) })}`, { credentials: "omit" });
      } catch (_) {
        throw new Error("Le service de lecture n’a pas répondu.");
      }
      let data = null;
      try { data = JSON.parse(await res.text()); } catch (_) { data = null; }
      if (!res.ok) {
        const err = new Error(res.status === 404 ? "Catalogue Shopify introuvable à cette adresse."
          : res.status === 401 || res.status === 403 ? "La boutique Shopify est protégée par un mot de passe ou bloque la lecture publique."
            : (data && data.message) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      if (!data || !Array.isArray(data.products)) throw new Error("Réponse inattendue de la boutique.");
      return data.products;
    }

    async function fetchCatalog(onProgress = () => {}) {
      const products = [], seen = new Set();
      for (let n = 1; n <= MAX_PAGES; n++) {
        const list = await page(n);
        const fresh = list.filter(p => !seen.has(p.id));
        fresh.forEach(p => { seen.add(p.id); products.push(p); });
        onProgress(`${products.length} produits lus…`);
        if (list.length < PAGE_SIZE || !fresh.length) break;
      }
      return { products };
    }

    return { site: `https://${host}`, fetchCatalog };
  }

  // Sur Shopify, le prix barré est « compare_at_price » : au format WooCommerce, c’est le prix régulier.
  const prices = v => {
    const price = clean(v.price), before = clean(v.compare_at_price);
    return Number(before) > Number(price) ? [price, before] : ["", price];
  };
  const isDefault = p => (p.variants || []).length === 1 && /^default title$/i.test(clean(p.variants[0].title));
  const optionValues = v => [v.option1, v.option2, v.option3].map(clean);

  // Lignes ajoutées par des applis (retours gratuits, assurance livraison, garanties) : pas de vrais produits.
  // Elles partagent souvent une même UGS entre paliers de prix (« x-redo ») et n’ont ni description ni image.
  const TECH_VENDOR = /^(re:?do|route|seel|navidium|extend|xcover|shipaid|order ?protection)( app)?$/i;
  const TECH_TITLE = /(package|shipping|order|delivery) protection|free returns coverage|route (package )?protection|extend protection plan|green shipping protection|^(in-?)?store pickup|local pickup/i;
  const TECH_SKU = /^(x-redo|route|routeins|navidium|seel-)/i;
  function isTechnical(p) {
    if (TECH_VENDOR.test(clean(p.vendor)) || TECH_TITLE.test(clean(p.title))) return true;
    return (p.variants || []).some(v => TECH_SKU.test(clean(v.sku)));
  }

  /**
   * Catalogue au format du moteur (en-têtes CSV WooCommerce) à partir de /products.json.
   * Un produit sans option (« Default Title ») devient un produit simple ; sinon un produit variable et ses variantes.
   */
  function shopifyToCatalog(engine, { products: all }) {
    const ignored = all.filter(isTechnical).map(p => clean(p.title));
    const products = all.filter(p => !isTechnical(p));
    const maxAttrs = Math.max(1, ...products.map(p => (isDefault(p) ? 0 : (p.options || []).length)));
    const headers = ["ID", "Type", "SKU", "Name", "Published", "Description", "Sale price", "Regular price", "Images", "Parent", "In stock?"];
    // Type de produit Shopify comme catégorie, seulement si la boutique s’en sert (sinon une alerte par produit).
    const withType = products.some(p => clean(p.product_type));
    if (withType) headers.splice(8, 0, "Categories");
    const withGtin = products.some(p => (p.variants || []).some(v => "barcode" in v));
    if (withGtin) headers.push("GTIN, UPC, EAN, or ISBN");
    for (let n = 1; n <= maxAttrs; n++) headers.push(`Attribute ${n} name`, `Attribute ${n} value(s)`, `Attribute ${n} visible`, `Attribute ${n} global`);
    // Texte alternatif seulement si la boutique le renvoie : sans champ, pas de contrôle (pas de fausse alerte).
    const withAlt = products.some(p => (p.images || []).some(i => "alt" in i));
    const rows = [], imageAlt = [];
    const typeCell = p => (withType ? [clean(p.product_type)] : []);
    const gtinCell = v => (withGtin ? [clean(v && v.barcode)] : []);
    const alts = list => list.filter(i => i && i.src).map(i => ({ src: i.src, alt: clean(i.alt) }));

    products.forEach(p => {
      const variants = p.variants || [];
      const images = (p.images || []).map(i => i.src).filter(Boolean).join(", ");
      const simple = isDefault(p) || !variants.length;
      const options = simple ? [] : (p.options || []);
      if (simple) {
        const v = variants[0] || {};
        const row = [String(p.id), "simple", clean(v.sku), clean(p.title), "1", p.body_html || "", ...prices(v), ...typeCell(p), images, "", v.available === false ? "0" : "1", ...gtinCell(v)];
        for (let n = 0; n < maxAttrs; n++) row.push("", "", "", "");
        rows.push(row);
        imageAlt.push(withAlt ? alts(p.images || []) : undefined);
        return;
      }
      const row = [String(p.id), "variable", "", clean(p.title), "1", p.body_html || "", "", "", ...typeCell(p), images, "", variants.some(v => v.available !== false) ? "1" : "0", ...gtinCell(null)];
      for (let n = 0; n < maxAttrs; n++) {
        const o = options[n];
        row.push(o ? clean(o.name) : "", o ? (o.values || []).map(x => clean(x).replace(/[,|;]/g, "\\$&")).join(", ") : "", o ? "1" : "", o ? "0" : "");
      }
      rows.push(row);
      imageAlt.push(withAlt ? alts(p.images || []) : undefined);

      variants.slice().sort((a, b) => a.id - b.id).forEach(v => {
        const values = optionValues(v);
        const named = values.slice(0, options.length).filter(Boolean);
        const img = v.featured_image && v.featured_image.src ? v.featured_image.src : "";
        const vrow = [String(v.id), "variation", clean(v.sku), `${clean(p.title)}${named.length ? " - " + named.join(", ") : ""}`, "1", "", ...prices(v), ...typeCell({}), img, `id:${p.id}`, v.available === false ? "0" : "1", ...gtinCell(v)];
        for (let n = 0; n < maxAttrs; n++) {
          const o = options[n];
          vrow.push(o ? clean(o.name) : "", o ? values[n] : "", "", o ? "0" : "");
        }
        rows.push(vrow);
        imageAlt.push(withAlt && v.featured_image ? alts([v.featured_image]) : undefined);
      });
    });

    const catalog = engine.catalogFromRows(headers, rows, rows.map((_, i) => i + 2), ",");
    if (withAlt) catalog.imageAlt = imageAlt;
    // Shopify donne largeur et hauteur de chaque image : pas besoin de les télécharger pour les mesurer.
    catalog.knownSizes = {};
    products.forEach(p => [...(p.images || []), ...(p.variants || []).map(v => v.featured_image).filter(Boolean)]
      .forEach(i => { if (i.src && i.width > 0 && i.height > 0) catalog.knownSizes[i.src] = { width: i.width, height: i.height }; }));
    catalog.source = "public";
    catalog.platform = "shopify";
    catalog.ignored = ignored;
    return catalog;
  }

  const api = { createShopifyClient, shopifyToCatalog, isTechnical };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WayPilotShopify = api;
})(typeof window !== "undefined" ? window : globalThis);

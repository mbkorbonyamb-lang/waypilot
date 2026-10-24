/*
 * WayPilot — moteur d'analyse des catalogues e-commerce.
 * Aucune dépendance au DOM : utilisable dans le navigateur (window.WayPilotEngine)
 * et dans Node (module.exports) pour les tests.
 */
(function (root) {
  "use strict";

  const SEVERITY = { HIGH: "Élevée", MEDIUM: "Moyenne", LOW: "Faible" };
  const FOLLOWUP = {
    PROPOSAL: "Correction proposée",
    MISSING_INFO: "Information manquante",
    HUMAN: "Vérification humaine",
    EXISTS: "Vérifiée dans WooCommerce — non ajoutée au CSV",
    VARIATION_ADDED: "Variation validée pour ajout au CSV"
  };

  // ---------- Normalisation ----------

  function normalize(value) {
    return String(value ?? "")
      .replace(/^﻿/, "")
      .replace(/[  ]/g, " ")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");
  }

  function clean(value) { return String(value ?? "").trim(); }

  // ---------- Lecture CSV ----------

  function detectDelimiter(text) {
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { i++; continue; }
        quoted = !quoted;
      } else if (!quoted && (c === "\n" || c === "\r")) break;
      else if (!quoted && Object.prototype.hasOwnProperty.call(counts, c)) counts[c]++;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best[1] === 0) throw new Error("Séparateur CSV introuvable. Utilisez un fichier CSV séparé par des virgules, des points-virgules ou des tabulations.");
    return best[0];
  }

  /**
   * Lit un CSV (RFC 4180, champs multilignes acceptés).
   * Retourne les lignes de données avec le numéro de ligne physique où chacune commence.
   */
  function parseCSV(text) {
    text = String(text ?? "").replace(/^﻿/, "");
    const delimiter = detectDelimiter(text);
    const records = [];
    let row = [], field = "", quoted = false, line = 1, startLine = 1;
    const endRecord = () => {
      row.push(field);
      if (row.some(v => v.trim() !== "")) records.push({ values: row, line: startLine });
      row = []; field = "";
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (c === delimiter && !quoted) {
        row.push(field); field = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        endRecord();
        line++;
        startLine = line;
      } else {
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
        field += c;
      }
    }
    endRecord();
    if (quoted) throw new Error("Le fichier se termine au milieu d’un champ entre guillemets. Le CSV est probablement tronqué ou mal exporté.");
    if (records.length < 2) throw new Error("Le CSV doit contenir un en-tête et au moins un produit.");
    const headers = records[0].values.map(v => v.replace(/^﻿/, "").trim());
    if (headers.every(h => !h)) throw new Error("Les noms des colonnes sont absents.");
    if (headers.length < 3) throw new Error("La structure du CSV semble incorrecte (moins de 3 colonnes). Vérifiez le séparateur ou réexportez le catalogue.");
    const data = records.slice(1);
    const rows = data.map(r => headers.map((_, i) => r.values[i] ?? ""));
    const lines = data.map(r => r.line);
    const catalog = buildCatalog(headers, rows, lines, delimiter);
    if (catalog.col.name >= 0 && !rows.some(r => clean(r[catalog.col.name]))) {
      throw new Error("Les lignes ont été lues, mais aucun nom de produit n’a été retrouvé. Vérifiez le séparateur et le format CSV.");
    }
    return catalog;
  }

  // ---------- Colonnes ----------

  const ALIASES = {
    type: ["type"],
    name: ["name", "nom", "nom du produit", "product name", "nom de l'article", "nom produit", "product", "titre", "title"],
    price: ["regular price", "regular_price", "prix", "prix regulier", "price", "tarif standard", "prix standard", "prix de vente", "tarif regulier"],
    salePrice: ["tarif promo", "prix promo", "prix promotionnel", "sale price", "sale_price"],
    description: ["description", "description du produit"],
    shortDescription: ["short description", "description courte", "description breve"],
    sku: ["sku", "reference", "ugs"],
    parent: ["parent", "parent id", "parent_id", "identifiant parent", "produit parent"],
    id: ["id", "identifiant", "product id", "product_id"],
    category: ["categories", "category", "product categories"],
    stock: ["en stock ?", "in stock?", "stock status", "stock_status"],
    stockQuantity: ["stock quantity", "stock_quantity", "quantite en stock", "quantite", "stock"],
    manageStock: ["manage stock?", "manage stock", "gerer le stock ?"],
    status: ["status", "statut"],
    published: ["publie", "published"],
    images: ["images", "image", "images du produit", "product images"],
    purchasable: ["purchasable", "achetable"],
    gtin: ["gtin, upc, ean, or isbn", "gtin, upc, ean ou isbn", "gtin", "ean", "upc", "isbn", "code-barres", "code barre", "global unique id", "global_unique_id"]
  };

  // Colonnes d'attributs WooCommerce, en français et en anglais, numérotées.
  const ATTRIBUTE_PATTERNS = {
    name: [/^attribute (\d+) name$/, /^nom de l'attribut (\d+)$/],
    value: [/^attribute (\d+) value\(s\)$/, /^attribute (\d+) values?$/, /^valeur\(s\) de l'attribut (\d+)$/, /^valeurs? de l'attribut (\d+)$/],
    global: [/^attribute (\d+) global$/, /^attribut (\d+) global$/],
    visible: [/^attribute (\d+) visible$/, /^attribut (\d+) visible$/]
  };

  function buildCatalog(headers, rows, lines, delimiter) {
    const normalized = headers.map(normalize);
    const col = {};
    for (const [key, list] of Object.entries(ALIASES)) {
      const accepted = new Set(list.map(normalize));
      col[key] = normalized.findIndex(h => accepted.has(h));
    }
    const byNumber = new Map();
    normalized.forEach((h, i) => {
      for (const [part, patterns] of Object.entries(ATTRIBUTE_PATTERNS)) {
        for (const re of patterns) {
          const m = h.match(re);
          if (m) {
            const n = Number(m[1]);
            if (!byNumber.has(n)) byNumber.set(n, { n, nameCol: -1, valueCol: -1, globalCol: -1, visibleCol: -1 });
            const slot = byNumber.get(n);
            if (slot[part + "Col"] < 0) slot[part + "Col"] = i;
          }
        }
      }
    });
    // Formats simplifiés « attribute_name / attribute_value » : un seul attribut.
    if (!byNumber.size) {
      const n = normalized.indexOf("attribute_name"), v = normalized.indexOf("attribute_value");
      if (n >= 0 && v >= 0) byNumber.set(1, { n: 1, nameCol: n, valueCol: v, globalCol: -1, visibleCol: -1 });
    }
    const attrCols = [...byNumber.values()].filter(a => a.nameCol >= 0 && a.valueCol >= 0).sort((a, b) => a.n - b.n);
    return { headers, rows, lines, delimiter, col, attrCols };
  }

  function getter(catalog) {
    return (row, key) => {
      const i = catalog.col[key];
      return i >= 0 ? row[i] : null;
    };
  }

  // ---------- Montants ----------

  /**
   * Convertit un prix en nombre.
   * decimal : "auto" (défaut), "." ou ",".
   * En mode auto, un séparateur unique suivi de 3 chiffres est lu comme séparateur de milliers
   * (1.200 → 1200), sauf après un zéro seul (0.500 → 0,5).
   */
  function parseAmount(raw, decimal = "auto") {
    let s = String(raw ?? "").replace(/[\s  ']/g, "");
    if (!s) return NaN;
    if (!/^[-+]?(\d|[.,](?=\d))[\d.,]*$/.test(s)) return NaN;
    const sign = s[0] === "-" ? -1 : 1;
    s = s.replace(/^[-+]/, "");
    const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    const validThousands = (str, sep) => {
      const parts = str.split(sep);
      return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(p => /^\d{3}$/.test(p));
    };
    let dec = null, thou = null;
    if (decimal === "." || decimal === ",") {
      dec = decimal; thou = decimal === "." ? "," : ".";
    } else if (dots && commas) {
      dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
      thou = dec === "." ? "," : ".";
    } else if (dots || commas) {
      const sep = dots ? "." : ",";
      const count = dots || commas;
      if (count > 1) { thou = sep; }
      else {
        const [before, after] = s.split(sep);
        if (after.length === 3 && before !== "0" && /^\d{1,3}$/.test(before)) thou = sep;
        else dec = sep;
      }
    }
    let intPart = s, fracPart = "";
    if (dec && s.includes(dec)) {
      const idx = s.lastIndexOf(dec);
      if (s.indexOf(dec) !== idx) return NaN;
      intPart = s.slice(0, idx); fracPart = s.slice(idx + 1);
      if (!/^\d+$/.test(fracPart)) return NaN;
    }
    if (thou && intPart.includes(thou)) {
      if (!validThousands(intPart, thou)) return NaN;
      intPart = intPart.split(thou).join("");
    }
    if (!/^\d*$/.test(intPart) || (!intPart && !fracPart)) return NaN;
    return sign * Number((intPart || "0") + (fracPart ? "." + fracPart : ""));
  }

  const CURRENCY = "(?:DHS?|MAD|GNF|EUR|USD|GBP|CHF|CAD|TND|DZD|F\\s?CFA|CFA|XOF|XAF|€|\\$|£)";
  const NUMBER = "\\d{1,3}(?:[ \\u00A0\\u202F.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
  const AMOUNT_RE = new RegExp(`(${NUMBER})\\s*${CURRENCY}(?![A-Za-z])|(?<![A-Za-z])${CURRENCY}\\s*[:：]?\\s*(${NUMBER})`, "gi");

  function stripHtml(text) {
    return String(text ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&euro;/gi, "€");
  }

  /**
   * Montants avec devise trouvés dans un texte. Chaque montant porte aussi des lectures
   * alternatives quand des espaces peuvent être des séparateurs de milliers ou non
   * (« Taille 42 300 DH » peut signifier 300 DH).
   */
  function extractAmounts(text) {
    const out = [];
    for (const m of stripHtml(text).matchAll(AMOUNT_RE)) {
      const raw = (m[1] || m[2]).trim();
      const value = parseAmount(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      const alternatives = new Set([value]);
      const groups = raw.split(/[   ]+/);
      for (let k = 1; k < groups.length; k++) {
        const alt = parseAmount(groups.slice(k).join(""));
        if (Number.isFinite(alt) && alt > 0) alternatives.add(alt);
      }
      out.push({ raw, value, alternatives: [...alternatives] });
    }
    return out;
  }

  const sameAmount = (a, b) => Math.abs(a - b) < 0.005;

  // ---------- Types de produits ----------

  function productType(raw) {
    const tokens = normalize(raw).split(/\s*,\s*/).filter(Boolean);
    const known = ["variation", "variable", "grouped", "external", "simple"];
    const primary = tokens.find(t => known.includes(t)) || tokens[0] || "";
    return { raw: clean(raw), primary, isVariation: primary === "variation", isVariable: primary === "variable", isGrouped: primary === "grouped" };
  }

  function cleanId(value) { return normalize(value).replace(/^id\s*:\s*/, "").trim(); }

  // Nom lisible : sans balises HTML (certains thèmes exportent « T-shirt<span> - </span>XL »).
  function displayName(value) { return stripHtml(value).replace(/\s+/g, " ").trim(); }

  // ---------- Codes GTIN (EAN, UPC, ISBN) ----------

  /**
   * Raison pour laquelle Google Merchant Center refuserait ce GTIN, ou null s'il est valide (ou vide).
   * Règles : 8, 12, 13 ou 14 chiffres, clé de contrôle GS1 juste, pas de plage réservée (2, 02, 04) ni de coupon (05, 98, 99).
   */
  function gtinProblem(raw) {
    const s = String(raw ?? "").replace(/[\s-]/g, "");
    if (!s) return null;
    if (/^\d{9}[\dXx]$/.test(s)) return "ISBN à 10 chiffres, Google demande l’ISBN à 13 chiffres";
    if (!/^\d+$/.test(s)) return "il contient autre chose que des chiffres";
    if (![8, 12, 13, 14].includes(s.length)) return `${s.length} chiffres au lieu de 8, 12, 13 ou 14`;
    const digits = s.split("").map(Number);
    const check = digits.pop();
    const sum = digits.reverse().reduce((t, d, i) => t + d * (i % 2 === 0 ? 3 : 1), 0);
    if ((10 - sum % 10) % 10 !== check) return "la clé de contrôle (dernier chiffre) est fausse, il y a sans doute une faute de frappe";
    if (s.length > 8) {
      const g13 = s.length === 14 ? s.slice(1) : s.padStart(13, "0");
      if (/^(2|02|04)/.test(g13)) return "code réservé à un usage interne (préfixe 2, 02 ou 04), pas un code fabricant";
      if (/^(05|98|99)/.test(g13)) return "code de bon de réduction, pas un code produit";
    }
    return null;
  }

  // ---------- Analyse ----------

  const SIZE_TOKENS = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL", xxl: "XXL", xxxl: "XXXL", "2xl": "2XL", "3xl": "3XL", "4xl": "4XL" };

  function splitValues(raw) { return String(raw ?? "").split(/\s*[,|;]\s*/).map(v => v.trim()).filter(Boolean); }

  function skuSlug(value, max) {
    return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, max);
  }

  /**
   * options : { skuPrefix, regenerateAllSkus, decimal }
   * Retourne { issues, proposals, manualCandidates, stats }.
   */
  function analyze(catalog, options = {}) {
    const { rows, lines, col, attrCols } = catalog;
    const get = getter(catalog);
    const decimal = options.decimal || "auto";
    const issues = [];
    const add = (rowIndex, code, severity, message, extra = {}) => issues.push({
      key: `${rowIndex}|${code}|${extra.detail ?? ""}`,
      code, severity, message,
      row: rowIndex,
      line: rowIndex >= 0 ? lines[rowIndex] : null,
      product: rowIndex >= 0 ? displayName(get(rows[rowIndex], "name")) : "",
      productId: rowIndex >= 0 ? clean(get(rows[rowIndex], "id")).replace(/^id\s*:\s*/i, "") : "",
      ...extra
    });

    // Colonnes absentes : une seule anomalie globale, pas une par ligne.
    if (col.name < 0) add(-1, "NAME_COLUMN_MISSING", SEVERITY.HIGH, "Colonne du nom introuvable");
    if (col.price < 0) add(-1, "PRICE_COLUMN_MISSING", SEVERITY.HIGH, "Colonne du prix régulier introuvable");
    if (col.description < 0 && col.shortDescription < 0) add(-1, "DESCRIPTION_COLUMN_MISSING", SEVERITY.LOW, "Colonne de description absente");
    if (col.category < 0) add(-1, "CATEGORY_COLUMN_MISSING", SEVERITY.LOW, "Colonne des catégories introuvable");

    const types = rows.map(r => productType(get(r, "type")));
    const byId = new Map(), bySku = new Map();
    rows.forEach((r, i) => {
      const id = cleanId(get(r, "id"));
      if (id) byId.set(id, i);
      const sku = normalize(get(r, "sku"));
      if (sku && !bySku.has(sku)) bySku.set(sku, i);
    });
    const resolveParent = raw => {
      const ref = normalize(raw);
      if (!ref) return -1;
      if (/^id\s*:/.test(ref)) { const i = byId.get(cleanId(ref)); return i ?? -1; }
      if (bySku.has(ref)) return bySku.get(ref);
      return byId.has(ref) ? byId.get(ref) : -1;
    };

    const attributesOf = row => attrCols.map(a => ({
      n: a.n, nameCol: a.nameCol, valueCol: a.valueCol, globalCol: a.globalCol,
      name: clean(row[a.nameCol]), value: clean(row[a.valueCol])
    })).filter(a => a.name);

    const seenNames = new Map(), seenSkus = new Map(), seenGtins = new Map();
    // GTIN absent signalé seulement si le catalogue en utilise ailleurs : une marque propre n’en a souvent aucun.
    const catalogUsesGtin = col.gtin >= 0 && rows.some(r => clean(get(r, "gtin")));
    const imageSizes = catalog.imageSizes || null;
    const parentOf = new Array(rows.length).fill(-1);
    const proposals = [];
    const propose = p => { p.id = proposals.length; p.status = "pending"; p.line = lines[p.row]; p.product = displayName(get(rows[p.row], "name")); p.productId = clean(get(rows[p.row], "id")).replace(/^id\s*:\s*/i, ""); proposals.push(p); };

    rows.forEach((row, i) => {
      const t = types[i];
      const name = clean(get(row, "name"));
      if (col.name >= 0) {
        if (!name) add(i, "NAME_MISSING", SEVERITY.HIGH, "Nom du produit manquant");
        else if (!t.isVariation) {
          const k = normalize(name);
          if (seenNames.has(k)) add(i, "NAME_DUPLICATE", SEVERITY.MEDIUM, `Nom en double (ligne ${lines[seenNames.get(k)]})`);
          else seenNames.set(k, i);
        }
      }

      // Prix
      const priceRaw = clean(get(row, "price"));
      const saleRaw = clean(get(row, "salePrice"));
      const regular = priceRaw ? parseAmount(priceRaw, decimal) : NaN;
      const sale = saleRaw ? parseAmount(saleRaw, decimal) : NaN;
      if (col.price >= 0) {
        if (!priceRaw) {
          if (!t.isVariable && !t.isGrouped) add(i, "PRICE_MISSING", SEVERITY.HIGH, "Prix régulier manquant");
        } else if (!Number.isFinite(regular)) add(i, "PRICE_INVALID", SEVERITY.HIGH, `Format de prix invalide (« ${priceRaw} »)`);
        else if (regular <= 0) add(i, "PRICE_NON_POSITIVE", SEVERITY.HIGH, "Prix nul ou négatif");
      }
      if (saleRaw) {
        if (!Number.isFinite(sale) || sale <= 0) add(i, "SALE_INVALID", SEVERITY.HIGH, `Prix promotionnel invalide ou nul (« ${saleRaw} »)`);
        else if (Number.isFinite(regular) && regular > 0 && sale >= regular) add(i, "SALE_NOT_LOWER", SEVERITY.MEDIUM, "Prix promotionnel supérieur ou égal au prix régulier");
      }

      // Achetable : connu par l’audit express (API publique). Un prix absent est déjà signalé à part.
      if (col.purchasable >= 0 && clean(get(row, "purchasable")) === "0" && !t.isVariable && !t.isGrouped && Number.isFinite(regular) && regular > 0) {
        add(i, "NOT_PURCHASABLE", SEVERITY.HIGH, "Affiché sur la boutique, mais WooCommerce refuse de l’ajouter au panier");
      }

      // Description
      const description = get(row, "description"), shortDescription = get(row, "shortDescription");
      const hasText = clean(stripHtml(description)) || clean(stripHtml(shortDescription));
      if ((col.description >= 0 || col.shortDescription >= 0) && !hasText && !t.isVariation) {
        add(i, "DESCRIPTION_MISSING", SEVERITY.MEDIUM, "Description manquante (longue et courte)");
      }
      if (!t.isVariation && !t.isVariable && Number.isFinite(regular) && regular > 0) {
        const amounts = extractAmounts(`${description ?? ""} ${shortDescription ?? ""}`);
        const known = [regular, sale].filter(Number.isFinite);
        const matches = a => a.alternatives.some(v => known.some(k => sameAmount(v, k)));
        const mismatching = [...new Set(amounts.filter(a => !matches(a)).map(a => a.value))];
        if (amounts.length && mismatching.length === amounts.length) {
          if (mismatching.length === 1) {
            add(i, "PRICE_DESC_MISMATCH", SEVERITY.LOW, `Prix mentionné dans la description (${mismatching[0]}) différent du prix régulier (${regular}) — à vérifier`);
            propose({ row: i, kind: "priceRegular", col: col.price, label: "Aligner le prix régulier sur le montant indiqué dans la description", before: priceRaw, after: String(mismatching[0]), safe: false, resolves: ["PRICE_DESC_MISMATCH"], note: "À valider uniquement si le montant de la description est le bon prix. La description n’est pas modifiée." });
          } else {
            add(i, "PRICE_DESC_MULTIPLE", SEVERITY.LOW, `Plusieurs montants dans la description (${mismatching.join(", ")}), aucun égal au prix — vérification manuelle`);
          }
        }
      }

      // Images
      const images = get(row, "images");
      if (col.images >= 0) {
        const list = String(images ?? "").split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
        if (!list.length && !t.isVariation) add(i, "IMAGE_MISSING", SEVERITY.MEDIUM, "Aucune image");
        const seen = new Set(), unique = [];
        list.forEach(url => { const k = url.replace(/\s+/g, "").replace(/#.*$/, ""); if (!seen.has(k)) { seen.add(k); unique.push(url); } });
        if (unique.length < list.length) {
          add(i, "IMAGE_DUPLICATE", SEVERITY.LOW, "Image répétée plusieurs fois dans la liste des images du produit");
          propose({ row: i, kind: "images", col: col.images, label: "Retirer les URL d’images répétées", before: String(images), after: unique.join(", "), safe: true, resolves: ["IMAGE_DUPLICATE"] });
        }
        // Dimensions mesurées dans le navigateur (catalog.imageSizes) : seuils de Google Merchant Center.
        if (imageSizes) {
          const measured = unique.map(url => imageSizes[url]).filter(Boolean);
          const broken = measured.filter(m => m.broken).length;
          if (broken) add(i, "IMAGE_BROKEN", SEVERITY.MEDIUM, `${broken} image(s) ne s’affichent pas : adresse introuvable ou bloquée. À vérifier sur la fiche.`);
          const sized = measured.filter(m => !m.broken && m.width && m.height);
          if (sized.length) {
            const smallest = sized.reduce((a, b) => (Math.min(b.width, b.height) < Math.min(a.width, a.height) ? b : a));
            const side = Math.min(smallest.width, smallest.height), dims = `${smallest.width} × ${smallest.height} px`;
            if (side < 250) add(i, "IMAGE_TOO_SMALL", SEVERITY.MEDIUM, `Image trop petite (${dims}) : Google Shopping la refuse sous 250 px pour les vêtements et sous 100 px pour les autres produits`);
            else if (side < 500) add(i, "IMAGE_BELOW_500", SEVERITY.LOW, `Image de ${dims} : Google exigera au moins 500 × 500 px à partir du 31 janvier 2027`);
          }
        }
      }
      // Texte alternatif : connu seulement par la connexion directe (absent des exports CSV).
      const alts = catalog.imageAlt && catalog.imageAlt[i];
      if (alts && alts.length && !t.isVariation) {
        const distinct = alts.filter((a, k) => alts.findIndex(b => b.src === a.src) === k);
        const without = distinct.filter(a => !clean(a.alt)).length;
        if (without) add(i, "IMAGE_ALT_MISSING", SEVERITY.LOW, `${without} image(s) sur ${distinct.length} sans texte alternatif : utile au référencement Google et aux lecteurs d’écran`);
      }

      // GTIN (code-barres EAN, UPC, ISBN) : jamais généré, seulement contrôlé.
      if (col.gtin >= 0 && !t.isVariable && !t.isGrouped) {
        const gtin = clean(get(row, "gtin"));
        if (gtin) {
          const problem = gtinProblem(gtin);
          const k = gtin.replace(/[\s-]/g, "");
          if (problem) add(i, "GTIN_INVALID", SEVERITY.MEDIUM, `Code GTIN « ${gtin} » invalide : ${problem}. Google Shopping peut refuser ou limiter le produit.`);
          else if (seenGtins.has(k)) add(i, "GTIN_DUPLICATE", SEVERITY.MEDIUM, `Code GTIN « ${gtin} » déjà utilisé (ligne ${lines[seenGtins.get(k)]}) : chaque article doit avoir le sien`);
          else seenGtins.set(k, i);
        } else if (catalogUsesGtin) {
          add(i, "GTIN_MISSING", SEVERITY.LOW, "Code GTIN absent alors que d’autres produits du catalogue en ont un. À renseigner s’il existe (code-barres du fabricant), sans jamais l’inventer.");
        }
      }

      // SKU
      const sku = clean(get(row, "sku"));
      if (col.sku >= 0) {
        if (sku) {
          const k = normalize(sku);
          if (seenSkus.has(k)) add(i, "SKU_DUPLICATE", SEVERITY.HIGH, `Référence SKU en double (ligne ${lines[seenSkus.get(k)]})`);
          else seenSkus.set(k, i);
        } else if (!t.isVariation) add(i, "SKU_MISSING", SEVERITY.LOW, "Référence SKU absente (recommandée pour le suivi des produits)");
      }

      // Catégorie
      if (col.category >= 0 && !clean(get(row, "category")) && !t.isVariation) {
        add(i, "CATEGORY_MISSING", SEVERITY.LOW, "Catégorie manquante (à vérifier selon l’organisation de la boutique)");
      }

      // Stock
      const qtyRaw = clean(get(row, "stockQuantity"));
      const statusRaw = ({ instock: "1", outofstock: "0", "in stock": "1", "out of stock": "0", "en stock": "1", "en rupture": "0" })[normalize(get(row, "stock"))] ?? normalize(get(row, "stock"));
      if (qtyRaw) {
        const qty = Number(qtyRaw.replace(",", "."));
        if (!Number.isFinite(qty)) add(i, "STOCK_INVALID", SEVERITY.MEDIUM, `Quantité en stock invalide (« ${qtyRaw} »)`);
        else if (qty < 0) add(i, "STOCK_NEGATIVE", SEVERITY.MEDIUM, `Quantité en stock négative (${qty})`);
        else if (statusRaw === "1" && qty === 0) add(i, "STOCK_STATUS_MISMATCH", SEVERITY.LOW, "Indiqué en stock alors que la quantité est 0");
        else if (statusRaw === "0" && qty > 0) add(i, "STOCK_STATUS_MISMATCH", SEVERITY.LOW, `Indiqué en rupture alors que la quantité est ${qty}`);
      }
    });

    // ---------- Variations ----------
    const variationsByParent = new Map(); // parentIndex -> [rowIndex]
    const seenCombos = new Map();
    const duplicateVariations = new Map(); // ligne en double -> ligne gardée
    rows.forEach((row, i) => {
      if (!types[i].isVariation) return;
      const p = resolveParent(get(row, "parent"));
      if (p < 0 || !types[p].isVariable) {
        add(i, "VARIATION_PARENT_MISSING", SEVERITY.HIGH, "Variation rattachée à un parent absent du fichier ou non variable");
        return;
      }
      parentOf[i] = p;
      if (!variationsByParent.has(p)) variationsByParent.set(p, []);
      variationsByParent.get(p).push(i);
      const attrs = attributesOf(row);
      if (!attrs.length) { add(i, "VARIATION_NO_ATTRIBUTE", SEVERITY.HIGH, "Attribut de variation manquant"); return; }
      const combo = attrs.map(a => `${normalize(a.name)}=${normalize(a.value) || "*"}`).sort().join("&");
      const key = `${p}|${combo}`;
      if (seenCombos.has(key)) {
        const first = seenCombos.get(key);
        const firstId = cleanId(get(rows[first], "id"));
        add(i, "VARIATION_DUPLICATE", SEVERITY.HIGH, `Combinaison de variation en double (ligne ${lines[first]}${firstId ? `, ID ${firstId}` : ""})`);
        duplicateVariations.set(i, first);
      } else seenCombos.set(key, i);
    });

    const manualCandidates = [];
    variationsByParent.forEach((children, p) => {
      const parentRow = rows[p];
      const parentAttrs = new Map(attributesOf(parentRow).map(a => [normalize(a.name), a]));
      // Attributs réellement utilisés par les variations de ce parent.
      const used = new Map(); // nom normalisé -> { values:Set, any:boolean }
      children.forEach(c => {
        attributesOf(rows[c]).forEach(a => {
          const k = normalize(a.name);
          if (!used.has(k)) used.set(k, { values: new Set(), any: false });
          if (a.value) used.get(k).values.add(normalize(a.value)); else used.get(k).any = true;
          const pa = parentAttrs.get(k);
          if (!pa) {
            add(c, "VARIATION_ATTRIBUTE_UNDECLARED", SEVERITY.MEDIUM, `Attribut « ${a.name} » absent du produit parent`, { detail: k });
            return;
          }
          if (!a.value) return;
          const options = splitValues(pa.value);
          const exact = options.find(o => normalize(o) === normalize(a.value));
          if (exact && exact !== a.value) {
            propose({ row: c, kind: "attributeValue", col: a.valueCol, label: `Aligner « ${a.name} » sur l’orthographe du produit parent`, before: a.value, after: exact, safe: true, resolves: [] });
          } else if (!exact) {
            add(c, "VARIATION_VALUE_UNDECLARED", SEVERITY.MEDIUM, `Valeur « ${a.value} » de « ${a.name} » non annoncée par le produit parent`, { detail: k });
            const size = SIZE_TOKENS[normalize(a.value)];
            const close = size && options.find(o => normalize(o) === normalize(size));
            if (close) propose({ row: c, kind: "attributeValue", col: a.valueCol, label: "Mettre la taille au format du parent — à confirmer", before: a.value, after: close, safe: false, resolves: ["VARIATION_VALUE_UNDECLARED"] });
          }
        });
      });

      // Valeurs annoncées par le parent sans variation correspondante (attributs utilisés seulement).
      used.forEach((u, k) => {
        if (u.any) return;
        const pa = parentAttrs.get(k);
        if (!pa) return;
        splitValues(pa.value).forEach(option => {
          if (u.values.has(normalize(option))) return;
          const detail = `${k}=${normalize(option)}`;
          add(p, "VARIATION_VALUE_MISSING", SEVERITY.MEDIUM, `${pa.name} « ${option} » proposée sur le produit, mais aucune variation « ${option} » dans l’export : sur la boutique, elle n’est sans doute pas commandable. Vérifiez l’onglet Variations du produit (variation créée, avec un prix et activée).`, { detail, attribute: pa.name, value: option });
          // Ajout assisté seulement quand un seul attribut est utilisé : la combinaison est alors sans ambiguïté.
          if (used.size === 1) {
            const parentId = cleanId(get(parentRow, "id")), parentSku = clean(get(parentRow, "sku"));
            const parentRef = parentId ? `id:${parentId}` : parentSku;
            if (!parentRef) return;
            const siblingPrices = [...new Set(children.map(c => clean(get(rows[c], "price"))).filter(Boolean))];
            const parentPrice = clean(get(parentRow, "price"));
            const price = parentPrice || (siblingPrices.length === 1 ? siblingPrices[0] : "");
            manualCandidates.push({
              key: `${p}|${detail}`,
              issueKey: `${p}|VARIATION_VALUE_MISSING|${detail}`,
              parentRow: p, parentRef, parentName: displayName(get(parentRow, "name")),
              attributeNumber: pa.n, attributeName: pa.name, attributeValue: option,
              attributeGlobal: pa.globalCol >= 0 ? clean(parentRow[pa.globalCol]) : "",
              name: `${displayName(get(parentRow, "name"))} - ${option}`,
              price, priceSource: parentPrice ? "prix du parent" : (price ? "prix commun des autres variations" : "à saisir"),
              sku: "", stockQty: "", enabled: true, selected: true, validated: false
            });
          }
        });
      });
    });

    // ---------- Suppression des variations en double (connexion directe seulement : l’import CSV ne supprime rien) ----------
    if (options.allowDelete) {
      const describe = r => {
        const parts = [`prix ${clean(get(rows[r], "price")) || "vide"}`];
        const pub = clean(get(rows[r], "published"));
        parts.push(pub === "1" ? "publiée" : pub === "-1" ? "privée" : "non publiée");
        const qty = clean(get(rows[r], "stockQuantity"));
        if (qty) parts.push(`stock ${qty}`);
        return parts.join(", ");
      };
      duplicateVariations.forEach((first, i) => {
        const firstId = cleanId(get(rows[first], "id"));
        propose({
          row: i, kind: "deleteVariation", col: -1,
          label: `Supprimer cette variation en double${firstId ? ` (garder l’ID ${firstId})` : ""}`,
          before: describe(i), after: "supprimée",
          safe: false, resolves: ["VARIATION_DUPLICATE"],
          note: `Variation gardée : ${describe(first)}. Suppression définitive : vérifiez que la variation gardée a le bon prix.`
        });
      });
    }

    // ---------- Propositions de SKU ----------
    if (col.sku >= 0) {
      const regenerateAll = !!options.regenerateAllSkus;
      const prefix = skuSlug(options.skuPrefix || "", 20) || "PRODUIT";
      const used = new Set();
      if (!regenerateAll) rows.forEach(r => { const s = normalize(get(r, "sku")); if (s) used.add(s); });
      let seq = 0;
      const seqOf = new Array(rows.length).fill(0);
      rows.forEach((r, i) => { if (!types[i].isVariation) seqOf[i] = ++seq; });
      const firstSkuOwner = new Map();
      rows.forEach((row, i) => {
        if (options.allowDelete && duplicateVariations.has(i)) return; // à supprimer, pas à référencer
        const current = clean(get(row, "sku"));
        const k = normalize(current);
        const isDuplicate = current && firstSkuOwner.has(k);
        if (current && !isDuplicate) firstSkuOwner.set(k, i);
        if (!regenerateAll && current && !isDuplicate) return;
        let base;
        if (types[i].isVariation) {
          const p = parentOf[i];
          const attrPart = attributesOf(row).map(a => skuSlug(a.value, 10)).filter(Boolean).join("-") || "VAR";
          base = `${prefix}-${String(p >= 0 ? seqOf[p] : i + 1).padStart(3, "0")}-${attrPart}`;
        } else {
          base = `${prefix}-${String(seqOf[i]).padStart(3, "0")}`;
        }
        let candidate = base, suffix = 2;
        while (used.has(normalize(candidate))) candidate = `${base}-${suffix++}`;
        used.add(normalize(candidate));
        const hasId = !!cleanId(get(row, "id"));
        const notes = [];
        if (current && !hasId) notes.push("Ligne sans ID : à l’import, WooCommerce risque de créer un nouveau produit au lieu de mettre à jour l’existant.");
        propose({
          row: i, kind: "sku", col: col.sku,
          label: isDuplicate ? "Remplacer la référence en double par une référence unique" : (current ? "Remplacer l’UGS par une référence normalisée unique" : "Générer une UGS unique"),
          before: current || "(vide)", after: candidate,
          safe: !current, // changer une référence existante n’est jamais « sûr »
          resolves: isDuplicate ? ["SKU_DUPLICATE"] : (current ? [] : ["SKU_MISSING"]),
          note: notes.join(" ")
        });
      });
    }

    // Lier chaque anomalie aux propositions qui la traitent (par ligne et code, pas par libellé).
    const proposalsByRow = new Map();
    proposals.forEach(p => { if (!proposalsByRow.has(p.row)) proposalsByRow.set(p.row, []); proposalsByRow.get(p.row).push(p); });
    issues.forEach(issue => {
      issue.proposalIds = (proposalsByRow.get(issue.row) || []).filter(p => p.resolves.includes(issue.code)).map(p => p.id);
    });

    // Score : chaque ligne perd des points selon ses anomalies (élevée 1, moyenne 0,5, faible 0,15), plafonné à 1 par ligne.
    const WEIGHT = { [SEVERITY.HIGH]: 1, [SEVERITY.MEDIUM]: 0.5, [SEVERITY.LOW]: 0.15 };
    const penalty = new Map();
    issues.filter(x => x.row >= 0).forEach(x => penalty.set(x.row, Math.min(1, (penalty.get(x.row) || 0) + WEIGHT[x.severity])));
    const lost = [...penalty.values()].reduce((a, b) => a + b, 0);
    const stats = {
      rows: rows.length,
      products: types.filter(t => !t.isVariation).length,
      variations: types.filter(t => t.isVariation).length,
      issues: issues.length,
      high: issues.filter(x => x.severity === SEVERITY.HIGH).length,
      score: rows.length ? Math.round(100 * (1 - lost / rows.length)) : 0,
      rowsWithIssues: penalty.size
    };
    return { issues, proposals, manualCandidates, stats };
  }

  const MISSING_INFO_CODES = new Set(["GTIN_MISSING", "IMAGE_ALT_MISSING", "DESCRIPTION_MISSING", "DESCRIPTION_COLUMN_MISSING", "CATEGORY_MISSING", "CATEGORY_COLUMN_MISSING", "IMAGE_MISSING", "NAME_COLUMN_MISSING", "PRICE_COLUMN_MISSING"]);

  /** Suite à donner pour une anomalie, selon l’état des décisions. */
  function followupFor(issue, state = {}) {
    const verified = state.verifiedExisting || new Set();
    const validatedVariations = state.validatedVariations || new Set();
    if (verified.has(issue.key)) return FOLLOWUP.EXISTS;
    if (validatedVariations.has(issue.key)) return FOLLOWUP.VARIATION_ADDED;
    if (issue.proposalIds && issue.proposalIds.length) return FOLLOWUP.PROPOSAL;
    if (MISSING_INFO_CODES.has(issue.code)) return FOLLOWUP.MISSING_INFO;
    return FOLLOWUP.HUMAN;
  }

  // ---------- Export ----------

  function csvField(value) { return '"' + String(value ?? "").replace(/"/g, '""') + '"'; }

  // Guillemets seulement si nécessaire, comme l’export WooCommerce. Indispensable pour la première colonne :
  // après le BOM, l’importeur WooCommerce (fgetcsv) lirait « "ID" » avec ses guillemets et ne reconnaîtrait plus la colonne ID.
  function csvFieldIfNeeded(value, delimiter) {
    const s = String(value ?? "");
    return s.includes(delimiter) || /["\r\n]/.test(s) || s !== s.trim() ? csvField(s) : s;
  }

  // Neutralise les formules quand le fichier est ouvert dans un tableur (rapport uniquement).
  function safeCell(value) {
    const s = String(value ?? "");
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function buildReportCSV(issues, state = {}) {
    const cols = ["Ligne du fichier", "ID", "Produit", "Code", "Anomalie", "Gravité", "Suite à donner"];
    const out = [cols.map(csvField).join(";")];
    issues.forEach(x => out.push([x.line ?? "—", x.productId ?? "", x.product, x.code, x.message, x.severity, followupFor(x, state)].map(v => csvField(safeCell(v))).join(";")));
    return "﻿" + out.join("\r\n");
  }

  /**
   * CSV corrigé : seules les propositions validées et les variations validées sont appliquées.
   * Les nouvelles variations ne reçoivent que les valeurs saisies par l’utilisateur.
   */
  function buildCorrectedCSV(catalog, proposals, manualVariations = []) {
    const { headers, rows, col, attrCols, delimiter } = catalog;
    const corrected = rows.map(r => r.slice());
    proposals.filter(p => p.status === "approved").forEach(p => {
      if (corrected[p.row] && p.col >= 0) corrected[p.row][p.col] = p.after;
    });
    manualVariations.filter(v => v.validated && v.selected).forEach(v => {
      const row = headers.map(() => "");
      const set = (key, value) => { if (col[key] >= 0) row[col[key]] = value; };
      set("type", "variation");
      set("name", v.name);
      set("parent", v.parentRef);
      set("price", v.price);
      set("sku", v.sku);
      set("published", v.enabled ? "1" : "0");
      if (clean(v.stockQty) !== "") {
        set("stockQuantity", clean(v.stockQty));
        set("manageStock", "1");
        set("stock", Number(v.stockQty) > 0 ? "1" : "0");
      }
      const a = attrCols.find(x => x.n === v.attributeNumber) || attrCols[0];
      if (a) {
        row[a.nameCol] = v.attributeName;
        row[a.valueCol] = v.attributeValue;
        if (a.globalCol >= 0) row[a.globalCol] = v.attributeGlobal;
      }
      corrected.push(row);
    });
    const field = v => csvFieldIfNeeded(v, delimiter);
    const lines = [headers.map(field).join(delimiter), ...corrected.map(r => headers.map((_, i) => field(r[i] ?? "")).join(delimiter))];
    return "﻿" + lines.join("\r\n");
  }

  // ---------- Rapport d’audit à remettre au client ----------

  // Classement par conséquence pour le marchand, et libellé lisible par un non-technicien.
  const REPORT_GROUPS = [
    { key: "sales", title: "Peut faire perdre des ventes", intro: "Le client ne peut pas commander, ou tombe sur un produit incomplet." },
    { key: "trust", title: "Information fausse ou incohérente", intro: "Le client voit une information contradictoire ou manquante, ce qui fait douter." },
    { key: "google", title: "Visibilité sur Google", intro: "Google Shopping et les fiches produits gratuites refusent ou limitent les produits concernés." },
    { key: "ops", title: "Gestion et présentation", intro: "Pas visible tout de suite par le client, mais source d’erreurs de stock, d’import ou de présentation." }
  ];
  const REPORT_CODES = {
    PRICE_MISSING: ["sales", "Prix absent : le produit ne peut pas être acheté"],
    NOT_PURCHASABLE: ["sales", "Affiché mais impossible à ajouter au panier"],
    PRICE_INVALID: ["sales", "Prix illisible"],
    PRICE_NON_POSITIVE: ["sales", "Prix nul ou négatif"],
    SALE_INVALID: ["sales", "Prix promotionnel invalide"],
    VARIATION_VALUE_MISSING: ["sales", "Taille ou option affichée mais impossible à commander"],
    VARIATION_DUPLICATE: ["sales", "Variation en double : le client peut tomber sur la mauvaise"],
    VARIATION_NO_ATTRIBUTE: ["sales", "Variation sans taille ni option"],
    VARIATION_PARENT_MISSING: ["sales", "Variation rattachée à aucun produit"],
    VARIATION_VALUE_UNDECLARED: ["sales", "Variation avec une valeur que le produit ne propose pas"],
    VARIATION_ATTRIBUTE_UNDECLARED: ["sales", "Variation avec une caractéristique que le produit ne déclare pas"],
    NAME_MISSING: ["sales", "Produit sans nom"],
    STOCK_NEGATIVE: ["sales", "Stock négatif"],
    STOCK_INVALID: ["sales", "Stock illisible"],
    PRICE_DESC_MISMATCH: ["trust", "Prix de la description différent du prix affiché"],
    PRICE_DESC_MULTIPLE: ["trust", "Plusieurs prix différents dans la description"],
    SALE_NOT_LOWER: ["trust", "Prix promotionnel supérieur ou égal au prix normal"],
    STOCK_STATUS_MISMATCH: ["trust", "Statut de stock contraire à la quantité"],
    NAME_DUPLICATE: ["trust", "Deux produits portent le même nom"],
    IMAGE_MISSING: ["trust", "Produit sans image"],
    DESCRIPTION_MISSING: ["trust", "Produit sans description"],
    SKU_MISSING: ["ops", "Référence (UGS) absente"],
    SKU_DUPLICATE: ["ops", "Référence (UGS) utilisée deux fois"],
    IMAGE_DUPLICATE: ["ops", "Même image répétée dans la galerie"],
    CATEGORY_MISSING: ["ops", "Produit sans catégorie"],
    IMAGE_BROKEN: ["trust", "Image qui ne s’affiche pas"],
    GTIN_INVALID: ["google", "Code-barres (GTIN) invalide"],
    GTIN_DUPLICATE: ["google", "Même code-barres (GTIN) sur deux articles"],
    GTIN_MISSING: ["google", "Code-barres (GTIN) absent"],
    IMAGE_TOO_SMALL: ["google", "Image trop petite pour Google Shopping"],
    IMAGE_BELOW_500: ["google", "Image sous 500 px, exigés par Google à partir de 2027"],
    IMAGE_ALT_MISSING: ["google", "Images sans texte alternatif"]
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  /**
   * Rapport HTML autonome et imprimable (Imprimer › PDF) : score, anomalies regroupées par conséquence.
   * info : { store, source, date }. Toutes les données de la boutique sont échappées.
   */
  function buildAuditReportHTML(result, info = {}) {
    const { issues, stats } = result;
    const groups = new Map(REPORT_GROUPS.map(g => [g.key, new Map()]));
    issues.filter(i => i.row >= 0).forEach(i => {
      const [group, label] = REPORT_CODES[i.code] || ["ops", i.message];
      const byCode = groups.get(group);
      if (!byCode.has(i.code)) byCode.set(i.code, { label, items: [] });
      byCode.get(i.code).items.push(i);
    });
    const structural = issues.filter(i => i.row < 0);
    const count = key => [...groups.get(key).values()].reduce((n, c) => n + c.items.length, 0);
    const productLabel = i => `${escapeHtml(i.product || "(sans nom)")}${i.productId ? ` <span class="id">ID ${escapeHtml(i.productId)}</span>` : ""}`;
    const section = g => {
      const byCode = groups.get(g.key);
      if (!byCode.size) return `<section><h2>${g.title} <span class="n">0</span></h2><p class="ok">Rien à signaler.</p></section>`;
      const rows = [...byCode.values()].sort((a, b) => b.items.length - a.items.length).map(c => {
        // Un produit par ligne, avec les valeurs concernées (ex. tailles L, XL).
        const products = new Map();
        c.items.forEach(i => {
          const k = `${i.productId}|${i.product}`;
          if (!products.has(k)) products.set(k, { issue: i, values: [] });
          if (i.value) products.get(k).values.push(i.value);
        });
        const cell = [...products.values()].map(p => productLabel(p.issue) + (p.values.length ? ` : ${escapeHtml(p.values.join(", "))}` : "")).join("<br>");
        return `<tr><td><strong>${escapeHtml(c.label)}</strong></td><td class="num">${c.items.length}</td><td>${cell}</td></tr>`;
      }).join("");
      return `<section><h2>${g.title} <span class="n">${count(g.key)}</span></h2><p class="intro">${g.intro}</p><table><thead><tr><th>Problème</th><th>Nombre</th><th>Produits concernés</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    };
    const date = info.date || new Date().toISOString().slice(0, 10);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Audit de catalogue — ${escapeHtml(info.store || "boutique")}</title>
<style>
body{font-family:Inter,Arial,sans-serif;color:#15243b;max-width:900px;margin:32px auto;padding:0 20px;line-height:1.5}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1769ff;padding-bottom:12px}
.brand{font-weight:800;font-size:22px}.brand span{color:#1769ff}.meta{color:#627087;font-size:13px;text-align:right}
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:24px 0}
.box{border:1px solid #e0e7f0;border-radius:10px;padding:14px}.box span{display:block;color:#627087;font-size:12px}.box strong{font-size:26px}
h1{font-size:26px;margin:24px 0 4px}h2{font-size:18px;margin:28px 0 4px}.n{background:#eaf1ff;color:#2458b8;border-radius:12px;padding:2px 9px;font-size:13px}
.intro{color:#627087;margin:0 0 8px;font-size:14px}.ok{color:#087443}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #e0e7f0;padding:8px;text-align:left;vertical-align:top}th{background:#f5f8fc}
.num{text-align:right;width:70px}.id{color:#627087;font-size:11px}
footer{margin-top:32px;color:#627087;font-size:12px;border-top:1px solid #e0e7f0;padding-top:10px}
@media print{body{margin:0}section{break-inside:avoid-page}}
@media(max-width:600px){.summary{grid-template-columns:1fr 1fr}}
</style></head><body>
<header><div class="brand">Way<span>Pilot</span></div><div class="meta">Audit du ${escapeHtml(date)}<br>${escapeHtml(info.source || "")}</div></header>
<h1>Audit du catalogue${info.store ? ` — ${escapeHtml(info.store)}` : ""}</h1>
<div class="summary">
<div class="box"><span>Score qualité</span><strong>${stats.score} %</strong></div>
${REPORT_GROUPS.map(g => `<div class="box"><span>${g.title}</span><strong>${count(g.key)}</strong></div>`).join("\n")}
</div>
<p>${stats.products} produits et ${stats.variations} variations contrôlés. ${issues.length ? `${issues.length} anomalies trouvées sur ${stats.rowsWithIssues} lignes.` : "Aucune anomalie trouvée."}</p>
${structural.length ? `<p class="intro">Remarques sur le fichier : ${structural.map(i => escapeHtml(i.message)).join(" ; ")}.</p>` : ""}
${REPORT_GROUPS.map(section).join("\n")}
<footer>Score : 100 % = aucune anomalie. Chaque ligne perd des points selon la gravité de ses anomalies. Ce rapport repose sur les contrôles automatiques de WayPilot : il ne garantit pas que toutes les données du catalogue sont exactes. Aucune modification n’a été faite par ce rapport.</footer>
</body></html>`;
  }

  /** Colonnes nécessaires pour ajouter une variation au CSV. */
  function missingColumnsForVariations(catalog) {
    const missing = ["type", "name", "parent", "price"].filter(k => catalog.col[k] < 0);
    if (!catalog.attrCols.length) missing.push("attributs");
    return missing;
  }

  const api = { VERSION: "1.12.1", SEVERITY, FOLLOWUP, normalize, parseCSV, catalogFromRows: buildCatalog, parseAmount, extractAmounts, productType, analyze, followupFor, buildReportCSV, buildCorrectedCSV, buildAuditReportHTML, missingColumnsForVariations, safeCell, gtinProblem };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WayPilotEngine = api;
})(typeof window !== "undefined" ? window : globalThis);

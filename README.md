# WayPilot

Le contrôle qualité intelligent de vos catalogues e-commerce.

WayPilot analyse un export CSV WooCommerce dans le navigateur (aucun envoi vers un serveur), signale les anomalies, propose des corrections à valider une par une et prépare un CSV corrigé à réimporter.

## Fichiers

- `index.html` : la page d'accueil commerciale.
- `app.html` : l'outil (interface).
- `mentions-legales.html` : mentions légales de Wayzure.
- `engine.js` : le moteur d'analyse, sans dépendance, testable dans Node.
- `woo.js` : connexion directe à une boutique WooCommerce (lecture du catalogue, application des corrections validées) et audit express par l'API publique.
- `relais/` : relais de l'audit express (Space Docker `waypilot/relais`), car WooCommerce bloque son API publique depuis un autre site.
- `tests/` : tests automatisés et CSV de test. Lancer : `node --test tests/engine.test.js tests/woo.test.js` (Node 18+) et `python3 -m unittest discover -s tests -p "relais_test.py"`.
- `CHANGEMENTS.md` : historique des versions.
- `legacy/streamlit/` : ancien prototype Streamlit, conservé pour mémoire.

## Publication

Le Space Hugging Face `waypilot/waypilot` est mis à jour automatiquement à chaque fusion sur `main`, si les tests passent (`.github/workflows/huggingface.yml`). Seuls `index.html` (accueil), `app.html` (outil), `mentions-legales.html`, `engine.js` et `woo.js` sont envoyés ; le README du Space n'est pas modifié. Le dossier `relais/` est publié sur le Space `waypilot/relais` (créé s'il n'existe pas).

Prérequis : un secret `HF_TOKEN` (jeton Hugging Face avec droit d'écriture) dans les réglages du dépôt.

## Référencement (Google)

- Adresse officielle : `https://waypilot.wayzure.com`. Les pages indexables (`index.html`, `app.html`, `securite.html`) portent une balise `canonical` vers cette adresse, sans `.html` (Cloudflare Pages redirige `/app.html` vers `/app`).
- `robots.txt` et `sitemap.xml` à la racine. Ajouter toute nouvelle page publique au sitemap et mettre à jour `lastmod`.
- `_headers` (Cloudflare Pages) envoie `X-Robots-Tag: noindex` sur `waypilot.pages.dev` et ses aperçus, pour éviter un doublon dans Google. Le Space Hugging Face est couvert par les balises `canonical`.
- `cgv.html`, `mentions-legales.html` et `prospection.html` restent en `noindex`.
- Image de partage (LinkedIn, WhatsApp…) : `assets/partage.jpg` (1200 × 630). Icônes : `favicon.ico`, `assets/icone-192.png`, `assets/apple-touch-icon.png`.

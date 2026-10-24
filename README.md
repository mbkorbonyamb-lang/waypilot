# WayPilot

Le contrôle qualité intelligent de vos catalogues e-commerce.

WayPilot analyse un export CSV WooCommerce dans le navigateur (aucun envoi vers un serveur), signale les anomalies, propose des corrections à valider une par une et prépare un CSV corrigé à réimporter.

## Fichiers

- `index.html` : la page d'accueil commerciale.
- `app.html` : l'outil (interface).
- `engine.js` : le moteur d'analyse, sans dépendance, testable dans Node.
- `woo.js` : connexion directe à une boutique WooCommerce (lecture du catalogue, application des corrections validées).
- `tests/` : tests automatisés et CSV de test. Lancer : `node --test tests/engine.test.js tests/woo.test.js` (Node 18+).
- `CHANGEMENTS.md` : changements de la version 1.7.0.
- `legacy/streamlit/` : ancien prototype Streamlit, conservé pour mémoire.

## Publication

Le Space Hugging Face `waypilot/waypilot` est mis à jour automatiquement à chaque fusion sur `main`, si les tests passent (`.github/workflows/huggingface.yml`). Seuls `index.html` (accueil), `app.html` (outil), `engine.js` et `woo.js` sont envoyés ; le README du Space n'est pas modifié.

Prérequis : un secret `HF_TOKEN` (jeton Hugging Face avec droit d'écriture) dans les réglages du dépôt.

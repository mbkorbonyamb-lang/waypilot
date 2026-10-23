# WayPilot

Le contrôle qualité intelligent de vos catalogues e-commerce.

WayPilot analyse un export CSV WooCommerce dans le navigateur (aucun envoi vers un serveur), signale les anomalies, propose des corrections à valider une par une et prépare un CSV corrigé à réimporter.

## Fichiers

- `index.html` : l'interface.
- `engine.js` : le moteur d'analyse, sans dépendance, testable dans Node.
- `tests/` : tests automatisés et CSV de test. Lancer : `node --test tests/engine.test.js` (Node 18+).
- `CHANGEMENTS.md` : changements de la version 1.7.0.
- `legacy/streamlit/` : ancien prototype Streamlit, conservé pour mémoire.

## Publication

Le Space Hugging Face `waypilot/waypilot` est mis à jour automatiquement à chaque fusion sur `main`, si les tests passent (`.github/workflows/huggingface.yml`). Seuls `index.html` et `engine.js` sont envoyés ; le README du Space n'est pas modifié.

Prérequis : un secret `HF_TOKEN` (jeton Hugging Face avec droit d'écriture) dans les réglages du dépôt.

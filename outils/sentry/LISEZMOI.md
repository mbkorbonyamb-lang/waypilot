# Module Sentry hébergé par WayPilot (sentry.min.js)

`sentry.min.js` est le module officiel `@sentry/browser` 11.10.0, réduit aux seules fonctions d'erreurs
(pas de performance, pas de vidéo de session). Il est hébergé avec le site : aucun appel à un site tiers
pour le charger. `erreurs.js` ne le télécharge qu'à la première erreur d'une page.

Pour le reconstruire (mise à jour de version) :

```
mkdir /tmp/sb && cd /tmp/sb && npm init -y
npm i --save-exact @sentry/browser@11.10.0 esbuild@0.25.10
cp <dépôt>/outils/sentry/entry.js .
npx esbuild entry.js --bundle --minify --format=iife --target=es2018 --legal-comments=none --outfile=<dépôt>/sentry.min.js
```

L'adresse DSN n'est jamais dans le dépôt : variable de dépôt GitHub `SENTRY_DSN`
(Settings > Secrets and variables > Actions > Variables), posée dans `erreurs.js` à la publication.

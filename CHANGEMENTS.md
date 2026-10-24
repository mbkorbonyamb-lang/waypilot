# WayPilot 1.8.1 — variations en double (retour du test JAARAY en connexion directe)

- Constat sur JAARAY : 30 variations dans la boutique pour 10 tailles réelles. Les 20 doublons ont des ID récents et viennent très probablement des imports CSV faits quand la colonne ID n'était pas reconnue (bug corrigé en 1.7.2).
- La variation la plus ancienne (ID le plus bas) sert désormais de référence. Avant, l'API renvoyant les plus récentes d'abord, c'est l'originale qui était signalée comme doublon.
- Connexion directe : WayPilot propose de supprimer chaque doublon, en affichant le prix et le statut du doublon et de la variation gardée. La suppression est à valider une par une (jamais incluse dans « corrections sûres ») et est définitive. Les doublons ne reçoivent pas d'UGS.
- Avec un CSV, aucune suppression n'est proposée : l'import WooCommerce ne sait pas supprimer.
- 2 tests ajoutés (25 au total).

# WayPilot 1.8.0 — connexion directe WooCommerce

- Nouveau : WayPilot peut lire le catalogue directement dans la boutique (API REST WooCommerce, clé « Lecture/Écriture ») et y écrire les corrections validées. Plus besoin d'exporter puis de réimporter un CSV, étape qui a échoué lors du test JAARAY.
- Corrections envoyées : UGS, prix régulier, images en double retirées (les images sont conservées dans la médiathèque), valeur d'attribut d'une variation, création des variations manquantes. Si l'attribut du parent n'est pas coché « Utilisé pour les variations », WayPilot le coche, sinon la nouvelle variation ne serait pas commandable.
- Rien n'est envoyé sans validation, ni sans confirmation. Un tableau donne le résultat élément par élément (une UGS déjà prise, par exemple, est signalée sans bloquer le reste).
- Les clés restent dans l'onglet du navigateur. HTTPS obligatoire. Authentification par paramètres d'URL, car beaucoup d'hébergeurs suppriment l'en-tête Authorization.
- Le CSV reste disponible en solution de repli.
- Bug corrigé : avec un format de prix imposé (point ou virgule), un prix entier comme « 445 » était lu 44,445.
- Nouveau fichier `woo.js`, 6 tests ajoutés (23 au total).

# WayPilot 1.7.2 — correctif import WooCommerce

- Correction d'un bug bloquant trouvé lors du test JAARAY : le CSV corrigé était refusé en silence par l'import WooCommerce. Le fichier commençait par un BOM suivi de `"ID"` entre guillemets. L'importeur de WooCommerce lisait alors l'en-tête comme `"ID"`, guillemets compris : la colonne ID n'était pas reconnue, aucun produit existant n'était retrouvé et rien n'était mis à jour.
- Le CSV corrigé n'utilise plus de guillemets que lorsqu'ils sont nécessaires, comme l'export WooCommerce.
- Test ajouté. La lecture de l'en-tête a aussi été vérifiée avec la fonction PHP utilisée par WooCommerce (`fgetcsv`).

# WayPilot 1.7.1 — retours du premier test réel (catalogue JAARAY)

- Le score qualité compte maintenant les anomalies faibles. Chaque ligne perd 1 point par anomalie élevée, 0,5 par anomalie moyenne et 0,15 par anomalie faible, avec au plus 1 point par ligne. Avant, un catalogue sans aucun SKU obtenait 94 %.
- L'ID WooCommerce s'affiche sous le nom du produit (anomalies et corrections) et devient une colonne du rapport CSV.
- Les noms sont affichés sans HTML : « T-shirt<span> - </span>XL » devient « T-shirt - XL ». Le CSV corrigé reste identique à l'original.
- Libellé plus clair pour une taille proposée sur le produit mais sans variation : il explique la conséquence (taille non commandable) et où vérifier (onglet Variations).
- 2 tests ajoutés (16 au total).

# WayPilot 1.7.0 — changements par rapport à 1.6.3

Copie de travail. Rien n'a été publié sur le Space Hugging Face.

## Fichiers
- `index.html` : l'interface.
- `engine.js` : le moteur d'analyse (lecture CSV, contrôles, propositions, exports), sans dépendance au navigateur.
- `tests/` : 14 tests automatisés et 2 CSV de test. Lancer : `node --test tests/engine.test.js` (Node 18+).

Pour publier sur le Space, il faut déposer `index.html` et `engine.js` ensemble.

## Bugs corrigés
1. Montants dans la description : « 12.50 EUR » était lu 1250. Les décimales sont maintenant conservées, et €, $ et £ sont reconnus. « Taille 42 300 DH » n'est plus signalé quand le prix vaut 300. Un montant égal au prix promo n'est plus signalé.
2. Prix « 1.200,00 » ou « 1,234.56 » : ils sont maintenant acceptés. Un nouveau réglage « Format des prix » permet d'imposer le séparateur décimal.
3. Multi-attributs (taille + couleur) : les attributs 1 à N sont lus, et le doublon se calcule sur la combinaison complète. L'ajout assisté d'une variation manquante n'est proposé que pour un produit à un seul attribut, parce qu'avec deux attributs la combinaison serait ambiguë.
4. Parent référencé par SKU : il est maintenant résolu, en plus de `id:123`.
5. Produits groupés : ils ne sont plus en « prix manquant ». Les types composés comme « variation, virtual » sont reconnus.
6. Variations ajoutées : le stock n'est plus fixé à 1 par défaut. La quantité est facultative ; si elle reste vide, aucune colonne de stock n'est écrite. « Activée » est une case visible. Le prix est prérempli avec le prix du parent ou le prix commun des autres variations, avec sa source affichée. L'attribut global du parent est recopié.
7. « Marquer comme déjà existante » n'efface plus la saisie ni les validations des variations manuelles.
8. Le lien entre une anomalie et sa correction passe par des codes stables (ex. `SKU_DUPLICATE`), et non plus par des mots du libellé.
9. « Ligne du fichier » donne la vraie ligne physique, même quand une description contient des retours à la ligne. Un fichier tronqué (guillemet non fermé) est refusé.
10. Performance : le calcul est devenu linéaire. 100 000 lignes (7,9 Mo) sont lues et analysées en 2,6 s dans Node.
11. Rapport CSV : les cellules commençant par = + - @ sont neutralisées. Le CSV corrigé, lui, reste fidèle aux données d'origine.
12. Une colonne absente donne une seule anomalie globale, au lieu d'une par ligne.

## Ajouts
- Nouveaux contrôles : image manquante, quantité invalide ou négative, statut de stock incohérent avec la quantité, attribut de variation absent du parent, description vide (longue et courte réunies).
- Un SKU en double reçoit une proposition de remplacement, jamais classée « sûre ». Une alerte s'affiche si la ligne n'a pas d'ID.
- Score qualité : part des lignes sans anomalie moyenne ou élevée.
- Le code de chaque anomalie apparaît à l'écran et dans le rapport.
- Relancer l'analyse demande une confirmation si des décisions ont déjà été prises.

## Non fait (étapes suivantes)
- Adaptateurs Shopify / PrestaShop (modèle de catalogue commun).
- Règles paramétrables par boutique au-delà du format de prix.
- Vérification que les URL d'images répondent (il faudrait des requêtes réseau).
- Couche commerciale (comptes, offre, rapport PDF).

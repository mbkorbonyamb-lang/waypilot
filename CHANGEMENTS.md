# WayPilot 1.16.1 — prix de variation aberrant

- Nouveau contrôle « Prix d’une variation très différent des autres » (moyenne, rubrique ventes) : dans un produit à 3 variations ou plus, un prix 5 fois plus bas ou plus haut que le prix habituel signale un chiffre oublié ou en trop (15,90 au lieu de 159,00). Les écarts normaux entre tailles ne sont pas signalés. 1 test ajouté.

# WayPilot 1.16.0 — audit en série pour la prospection

- Nouvelle page interne prospection.html (non référencée, sans lien) : on colle une liste d’adresses, chaque boutique WooCommerce ou Shopify est auditée comme en audit express (sans télécharger les images), puis classée : « À vérifier puis contacter » s’il y a une anomalie élevée ou moyenne qui touche la vente ou l’information client, « Cible faible » sinon, « Illisible » si ce n’est ni WooCommerce ni Shopify. L’exemple à citer est choisi dans la rubrique ventes d’abord. Export CSV.
- Moteur : prospectSummary(result). 1 test ajouté.

# WayPilot 1.15.4 — référence commune aux tailles d’un modèle (Shopify)

- Sur Shopify, beaucoup de boutiques mettent la même référence sur toutes les tailles d’un modèle (ex. « MOE-BAS-GEN1 »). C’était compté comme « Référence utilisée deux fois », gravité élevée : 5 375 alertes élevées sur natives-conceptstore.com, score écrasé. Ce cas devient « Même référence sur toutes les tailles d’un modèle », gravité faible. Une référence partagée entre deux produits différents reste élevée. 1 test ajouté.

# WayPilot 1.15.3 — virgule dans une valeur d’option

- Une valeur d’option contenant une virgule (carte cadeau « 100,00 € » sur Shopify) était coupée en deux (« 100 » et « 00 € ») : fausses alertes « taille affichée mais impossible à commander » et « valeur non annoncée par le parent ». Les virgules d’une valeur sont désormais échappées (« \, », comme dans l’export WooCommerce) pour Shopify et l’audit express WooCommerce. Vu sur natives-conceptstore.com. 1 test ajouté.

# WayPilot 1.15.2 — cartes cadeaux

- Cartes cadeaux (type « gift-card », « pw-gift-card »…) : leur prix reste à 0 € car le client choisit le montant. Plus d’alerte « Prix nul » élevée (fausse alerte vue sur b-a-conceptstore.com). 1 test ajouté.

# WayPilot 1.15.1 — taille des images sans téléchargement

- Le contrôle de taille des images était lent (jusqu’à 400 téléchargements). Shopify donne la largeur et la hauteur de chaque image ; WordPress les laisse déduire du srcset (plus grande largeur, proportions d’une version réduite « -300x450 »). Ces images ne sont plus téléchargées : seules les autres le sont, dans la même limite. 2 tests ajoutés.

# WayPilot 1.15.0 — corrections réservées aux clients, contact après l’audit

- L’audit reste gratuit (adresse, CSV ou clé en lecture seule). Les corrections — validation des propositions, catalogue corrigé, mode « Audit et corrections », application dans la boutique — demandent le code d’accès remis à la commande (Espace client). Le contrôle se fait dans le navigateur : il dissuade, il ne protège pas un secret. Le code est mémorisé sur l’appareil.
- Après un audit avec anomalies, un encadré « Vous voulez que ces erreurs soient corrigées ? » propose d’envoyer le résultat (site, score, nombre d’anomalies) par WhatsApp ou par e-mail, prérempli.

# Offre — suivi mensuel avec correction de départ incluse (26/10/2026)

- Le suivi à 49 € HT/mois inclut désormais la correction de départ (jusqu’à 100 produits), avec 3 mois minimum. Objectif : un prix d’entrée plus bas pour les petites boutiques (147 € sur 3 mois au lieu de 190 € d’un coup) et un revenu récurrent dès le premier client. La correction seule reste à 190 € / 390 € HT.
- Page d’accueil et CGV (version du 26 octobre 2026, articles 2 et 9) mises à jour. L’audit gratuit mentionne aussi Shopify.

# WayPilot 1.14.8 — photos principales vérifiées en priorité

- Sur une grande boutique (shop.femmeapart.com : 276 produits, 1 908 images), seules les 400 premières images de la liste étaient mesurées. La limite reste (chaque image est téléchargée en entier par le navigateur), mais la photo principale de chaque produit passe désormais en premier, puis celle de chaque variation, puis le reste de la galerie : les 276 produits ont tous leur photo principale contrôlée.

# WayPilot 1.14.7 — images « cassées » vérifiées deux fois

- Constaté sur boutiquesimplementvous.fr : 71 produits signalés « image qui ne s’affiche pas », probablement à tort (protection anti-hotlink ou limitation des requêtes par l’hébergeur).
- Les images sont chargées sans référent (contourne l’anti-hotlink le plus courant), les échecs sont réessayés une fois, lentement, et si plus de la moitié des images échouent, WayPilot conclut que le site bloque la lecture : pas d’alerte image par image, une mention dans le résumé.

# WayPilot 1.14.6 — noms de produits lisibles

- Constaté sur aliusodorem.com : WordPress renvoie les titres avec des entités HTML (« Aurea Fides &#8211; 1ml »), affichées telles quelles dans le tableau et le rapport. Les entités numériques et les plus courantes (tirets, apostrophes, guillemets) sont désormais décodées. 1 test ajouté.

# WayPilot 1.14.5 — produits vitrine (prix sur devis)

- Constaté sur fichet-bauche.fr : 18 produits (portes fortes, coffres bancaires) à prix 0, non achetables, bouton « Lire la suite ». Ce sont des produits vitrine sur devis, pas des erreurs. Ils remontaient en « Prix nul ou négatif », gravité élevée.
- Un produit sans prix ET non achetable (connu par l’audit express) devient « Produit vitrine sans prix », gravité faible, à confirmer. Un produit à prix 0 qui reste achetable est toujours signalé en élevé. 1 test ajouté.

# WayPilot 1.14.4 — audit express : sites multilingues

- Constaté sur fichet-bauche.fr (WPML, un domaine par langue : .fr, .nl, .com) : l’API publique renvoie chaque traduction comme un produit à part, avec la même UGS. Résultat : 150 « produits » au lieu d’environ 50, et plus de 100 fausses alertes « SKU en double » de gravité élevée.
- La langue de chaque produit se lit dans son adresse (domaine, préfixe /en/ ou ?lang=en). Si plusieurs langues apparaissent, seule celle de l’adresse auditée est gardée (sinon la plus fournie) ; le résumé indique combien de traductions ont été écartées. Les variations des traductions ne sont plus lues. 3 tests ajoutés.
- Limite connue : un export CSV ou une connexion par clé API d’un site WPML contient aussi toutes les langues.

# WayPilot 1.14.3 — Shopify : lignes techniques d’applis ignorées

- Constaté sur Allbirds : « Free Returns Coverage » (appli Redo) partage la référence « x-redo » entre ses paliers de prix, d’où une fausse alerte « SKU en double » de gravité élevée. Les lignes ajoutées par les applis de retours gratuits, d’assurance livraison ou de garantie (Redo, Route, Seel, Navidium, Extend, « Shipping Protection »…) sont désormais exclues de l’audit Shopify, repérées par le vendeur, le titre ou l’UGS. Le résumé indique combien ont été ignorées. 2 tests ajoutés.

# WayPilot 1.14.2 — doublon d’UGS : le produit concerné est nommé

- L’alerte « Référence SKU en double » donne la référence et le nom du produit qui la porte déjà, pas seulement son numéro de ligne (la première occurrence n’a pas d’anomalie et n’apparaît donc pas dans le tableau). 1 test ajouté.

# WayPilot 1.14.1 — score jamais à 100 % s’il reste une anomalie

- Constaté sur une grande boutique Shopify (5 012 lignes, 43 anomalies dont 8 élevées) : le score arrondi affichait 100 %, alors que la légende dit « 100 % = aucune anomalie ». Le score plafonne désormais à 99 % tant qu’il reste une anomalie. 1 test ajouté.

# WayPilot 1.14.0 — audit express des boutiques Shopify

- L’audit express accepte aussi les boutiques Shopify, par l’adresse seule. WayPilot essaie d’abord WooCommerce, puis Shopify, sans que l’utilisateur ait à choisir.
- Lecture du catalogue public `/products.json` (250 produits par page) par le relais Cloudflare, nouveau chemin `/shopify`. Aucune clé, rien n’est écrit dans la boutique : les corrections Shopify se font en service.
- Conversion vers le format du moteur : un produit sans option (« Default Title ») devient un produit simple ; sinon un produit variable et ses variantes. Le prix barré Shopify (`compare_at_price`) devient le prix régulier.
- Pas de fausse alerte : pas d’alerte UGS sur un produit à options (seules ses variantes portent une UGS sur Shopify), contrôle des catégories seulement si la boutique renseigne le type de produit, texte alternatif et GTIN non contrôlés (absents du catalogue public).
- `shopify.js` publié avec le site. 4 tests JS et 1 test du relais ajoutés.

# WayPilot 1.13.0 — texte alternatif des images corrigé automatiquement

- Connexion avec clé API : pour chaque produit dont des images n’ont pas de texte alternatif, WayPilot propose un texte construit à partir du nom du produit (« Caftan beldi rose », puis « Caftan beldi rose – vue 2 », etc.). Le texte proposé se modifie avant validation. Les textes déjà remplis ne changent pas.
- Toute la galerie est renvoyée, dans le même ordre, parce que WooCommerce remplace la liste d’images. Compatible avec le retrait des images en double. Le retour arrière remet les textes d’origine.
- Le texte est enregistré sur l’image de la médiathèque : il vaut pour tous les produits qui utilisent cette image.
- Audit express : pas de proposition, puisqu’il ne peut rien écrire. 2 tests ajoutés.

# WayPilot 1.12.2 — relais sur Cloudflare (gratuit)

- Hugging Face refuse désormais les Spaces Docker sans abonnement PRO (erreur 402). Le relais de l’audit express passe sur un Worker Cloudflare (`relais-cloudflare/`), même contrat que `relais/`.
- Le workflow déploie le Worker si les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` existent, sinon il ne fait rien. La variable de dépôt `RELAIS_URL` fixe l’adresse du relais utilisée par `app.html`.
- L’étape du Space `waypilot/relais` ne tourne que si `PUBLIER_RELAIS_HF` vaut `oui`.
- Mentions légales : hébergeur du relais = Cloudflare, Inc. 3 tests ajoutés.

# WayPilot 1.12.1 — relais pour l’audit express

- Constat après mise en ligne : WooCommerce n’autorise son API publique (Store API) que depuis le site de la boutique (`Authentication::send_cors_headers`). Depuis WayPilot, le navigateur était bloqué sur toutes les boutiques.
- Nouveau relais (`relais/`, Space Docker `waypilot/relais`, publié par le workflow) : il lit le catalogue public à la place du navigateur. Il ne reçoit que l’adresse de la boutique, n’accepte que le chemin des produits et quelques paramètres, refuse les adresses privées (y compris après redirection), limite taille et débit, et ne tient aucun journal.
- Si le relais dort (Space gratuit inactif depuis 48 h), le message invite à réessayer une minute plus tard.
- Mentions légales et FAQ mises à jour. 1 test JS et 4 tests Python ajoutés.

# WayPilot 1.12.0 — audit express : l’adresse de la boutique suffit

- **Audit sans clé.** On entre l’adresse d’une boutique WooCommerce, WayPilot lit son catalogue par l’API publique (Store API), celle que la boutique utilise pour s’afficher. Aucune clé, aucune installation, rien n’est modifié. On voit ce que voit un client : produits publiés et variations proposées à la vente.
- Les prix (en unités mineures dans cette API) et les valeurs de variation (parfois en slug, « xl ») sont convertis. Les variations sont lues par lots de 100.
- Nouveau contrôle « Affiché mais impossible à ajouter au panier » (WooCommerce déclare le produit non achetable alors qu’il a un prix).
- En audit express, les corrections et le CSV corrigé sont masqués : il faut une clé ou un export pour corriger. Le rapport client reste disponible.
- Page d’accueil : un champ « adresse de la boutique » lance l’audit (`app.html?boutique=…`). Nouvelle question dans la FAQ.
- Limites : brouillons, stocks chiffrés et codes-barres ne sont pas visibles ; une boutique peut bloquer cette API.
- 2 tests ajoutés (33 au total).

# WayPilot 1.11.0 — contrôles pour Google Shopping

- **Codes-barres (GTIN, EAN, UPC, ISBN).** Lus depuis la colonne « GTIN, UPC, EAN, or ISBN » de l’export CSV, ou par la connexion directe (champ natif de WooCommerce 9.2 et plus, ou champ d’une extension EAN/GTIN). Signalés : longueur fausse, clé de contrôle fausse (faute de frappe), plage réservée (2, 02, 04) ou de coupon (05, 98, 99), ISBN à 10 chiffres, code en double. Un GTIN absent n’est signalé que si d’autres produits du catalogue en ont un : une marque propre n’en a souvent aucun. WayPilot ne propose jamais de GTIN, il ne s’invente pas.
- **Taille des images.** Après la lecture du catalogue, l’outil mesure chaque image dans le navigateur (400 au plus). Signalés : image sous 250 px de côté (Google la refuse pour les vêtements, et sous 100 px pour tout produit), image sous 500 px (minimum exigé par Google à partir du 31 janvier 2027), image qui ne s’affiche pas. Une image trop lente ne déclenche pas d’alerte.
- **Texte alternatif des images** (connexion directe seulement, l’export CSV ne le contient pas).
- Le rapport d’audit client a une nouvelle rubrique « Visibilité sur Google ». La page d’accueil la présente.
- 4 tests ajoutés (31 au total).

# WayPilot 1.10.2 — contact et mentions légales

- Les boutons de contact de l'accueil ouvrent WhatsApp avec un message pré-rempli. Le numéro figure en pied de page.
- L'étude de cas nomme JAARAY, avec son accord.
- Nouvelle page `mentions-legales.html` (éditeur Wayzure SAS, hébergeur, données), reliée depuis l'accueil et l'outil, et publiée par le workflow.

# WayPilot 1.10.1 — page d'accueil commerciale

- `index.html` devient une page d'accueil : ce que WayPilot trouve, comment ça marche, un cas réel (anonymisé), les offres (audit gratuit en libre-service, audit accompagné, suivi mensuel), la sécurité.
- L'outil passe sur `app.html`. Le logo de l'outil ramène à l'accueil.
- Les boutons de contact restent masqués tant qu'aucune adresse n'est renseignée (`CONTACT_EMAIL` en bas de `index.html`).
- Le workflow publie aussi `app.html` sur le Space.

# WayPilot 1.10.0 — journal des modifications et annulation

- Après un envoi vers la boutique, « Télécharger le journal des modifications » donne un CSV avec une ligne par champ modifié : date, élément, champ, valeur avant, valeur après, résultat. C'est la preuve du travail fait, à remettre au client.
- « Annuler les modifications envoyées » remet les anciennes valeurs (UGS, prix, images, attributs) et supprime les variations créées. Les variations supprimées ne peuvent pas être recréées : la sauvegarde reste indispensable, et la fenêtre de confirmation le rappelle.
- Sécurité : après un envoi, un second envoi est bloqué tant que la boutique n'a pas été relue (il aurait recréé les mêmes variations).
- 1 test ajouté (27 au total).

# WayPilot 1.9.0 — mode audit en lecture seule et rapport d'audit client

- Nouveau choix « Mode » dans la connexion directe : « Audit en lecture seule » (par défaut) ou « Audit et corrections ».
- En lecture seule, le bouton d'envoi vers la boutique n'existe plus et un message l'explique. Une clé WooCommerce en droit « Lecture » suffit. C'est la base de l'audit gratuit proposé aux prospects : on ne peut rien modifier chez eux.
- Le rapport et le CSV corrigé restent disponibles dans les deux modes.
- Nouveau « rapport d'audit client » : une page à ouvrir dans le navigateur et à imprimer en PDF. Elle donne le score et classe les anomalies par conséquence pour le marchand (peut faire perdre des ventes, information fausse ou incohérente, gestion et présentation), en langage non technique, avec les produits concernés. Les données de la boutique sont échappées.
- 1 test ajouté (26 au total).

# WayPilot 1.8.2 — retour visible après validation

- Après « Valider la sélection », « Refuser la sélection » ou « Valider les corrections sûres », un message vert indique combien de corrections ont été prises en compte, et la page défile jusqu'au résumé. Avant, rien de visible ne changeait (retour du test JAARAY).
- Bilan du test JAARAY en connexion directe (1.8.1) : 55 modifications appliquées, 0 échec ; relecture : 25 produits, 10 variations, aucune anomalie.

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

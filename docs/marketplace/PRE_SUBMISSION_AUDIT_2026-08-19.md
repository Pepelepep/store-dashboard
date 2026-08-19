# ShopOps Studio — Audit pré-soumission Shopify App Store

Date de l'audit : 2026-08-19. Périmètre : configuration Shopify (tomls, webhooks, scopes), sécurité et
secrets, billing/entitlements, conformité (webhooks GDPR, politique de rétention), extension POS,
build/typecheck/lint, et recoupement de tous les documents internes de préparation marketplace déjà
présents dans `docs/marketplace/` et `MARKETPLACE_READINESS.md` contre l'état réel du code.

Méthode : lecture directe du code (staging depuis votre machine), deux sous-agents pour lire en
profondeur les gros documents de préparation et le module de permissions, exécution de commandes sur
votre machine (git, typecheck, lint, grep de secrets), et recherche web sur les exigences actuelles
Shopify App Store. Je n'ai pas eu accès à votre Partner Dashboard, à votre Render, ni à votre boîte
support — plusieurs points ci-dessous ne peuvent être confirmés que par vous.

## Résumé en une phrase

Le code est nettement plus solide que ce que les documents de préparation laissent penser une fois
mis à jour ; mais d'après vos propres documents, l'infrastructure marketplace dédiée (app Shopify,
service d'hébergement, base de données) et plusieurs approbations Shopify/légales ne sont pas encore
confirmées comme terminées — ce sont les vrais points à trancher avant de soumettre, pas le code.

## Bloquant — à régler avant ou pendant la soumission

**1. Infrastructure marketplace dédiée non confirmée.** `shopify.app.shopops-marketplace.toml` pointe
vers `https://shopops-marketplace-preview.onrender.com`, explicitement commenté dans le fichier comme
« temporary pre-launch hosting for this future production app ». `docs/marketplace/MARKETPLACE_ENVIRONMENT_SETUP.md`
liste une checklist « Pre-Review Environment Checklist » entièrement non cochée : app Shopify dédiée
créée, service Render dédié créé, environnement Supabase dédié créé, variables d'environnement
marketplace configurées, placeholders du toml remplacés, webhooks enregistrés, accès reviewer/admin
configuré, données démo chargées, screenshots capturés. Shopify exige une URL de production stable
pour la review — si cette checklist reflète encore la réalité, c'est le premier bloc à lever.
*À confirmer avec vous : cette checklist est-elle simplement restée non cochée par oubli alors que
c'est fait, ou reste-t-il réellement du travail d'infra à faire ?*

**2. Version d'API Admin sur le point d'expirer.** `app/shopify.server.ts` code en dur
`ApiVersion.October25` (2025-10) à deux endroits (le client `shopifyApp` et le client de token
exchange), alors que les webhooks du toml utilisent déjà `2026-07` et l'extension POS `2026-01`. Les
versions d'API Shopify sont supportées environ 12 mois après leur sortie : 2025-10 sera « sunset »
autour d'octobre 2026, donc dans environ deux mois. Si l'app est encore sur cette version à ce
moment-là, les appels Admin GraphQL commenceront à échouer. Recommandation concrète : aligner les
trois endroits (toml webhooks, `shopify.server.ts`, extension POS) sur la même version stable
actuelle avant ou juste après le lancement, et ajouter ce contrôle à votre process de release
récurrent plutôt que de le refaire au dernier moment à chaque trimestre.

**3. Approbation Shopify « Protected Customer Data » + `read_all_orders » non confirmée comme
obtenue.** C'est un prérequis Partner Dashboard distinct de la review d'app elle-même. Vos propres
documents (`MARKETPLACE_CHECKLIST.md`, `PARTNER_DASHBOARD_SUBMISSION_RUNBOOK.md`) listent cette
approbation comme non cochée. Sans elle, la demande du scope `read_all_orders` en soumission publique
peut bloquer ou faire échouer la review. *À confirmer : cette approbation a-t-elle été obtenue depuis
la rédaction de ces docs ?*

**4. Politique de confidentialité et conditions d'utilisation encore explicitement à l'état de
brouillon.** J'ai lu `PRIVACY_POLICY_DRAFT.md` et `TERMS_OF_SERVICE_DRAFT.md` en entier : les deux se
terminent littéralement par « This ... is a draft for marketplace readiness planning. It is not legal
advice and should not be published without legal and business review. » Publier ces textes tels quels
est un vrai risque légal, et une politique de confidentialité clairement marquée comme brouillon peut
aussi être jugée insuffisante en review. Il faut soit une relecture juridique avant publication, soit
au minimum retirer explicitement cette mention une fois le contenu validé comme définitif — jamais
publier avec cette mention encore présente dans le texte livré aux marchands.

**5. Gate de soumission interne non complété.** Les 16 lignes du « Final Submission Gate » dans
`PARTNER_DASHBOARD_SUBMISSION_RUNBOOK.md` sont toutes non cochées d'après le document, y compris des
vérifications basiques (HTTP 200 sur `/privacy`, `/terms`, `/support`, cohérence `client_id`/URLs entre
toml et Partner Dashboard, test réel des trois webhooks de conformité). Certaines de ces cases datent
probablement d'avant vos correctifs du 14 août et sont peut-être déjà résolues sans que le document
ait été remis à jour — mais à vérifier explicitement plutôt qu'à supposer coché.

## Élevé

**6. Contact d'urgence support non renseigné.** `SUPPORT_AND_CONTACTS.md` et le runbook marquent le
téléphone/email d'urgence développeur comme « Manual input required » / non défini (email seul en
canal d'urgence pour l'instant). Shopify demande un contact d'urgence exploitable en Partner
Dashboard.

**7. Test « Lifecycle B » (désinstallation réelle + réception effective du webhook `shop/redact`)
programmé pour vérification le 2026-08-11 — nous sommes le 2026-08-19.** `FINAL_REVIEW_EXECUTION_STATUS.md`
le décrit comme « IN PROGRESS » avec une échéance de vérification au 11 août. À confirmer que ce test
a bien été validé et documenté depuis.

**8. Incohérence de branche entre le gel de version et l'état local.** `V0_FREEZE_2026-08-09.md`
gèle la branche `marketplace/stable-prep` au tag `v0.1.0-rc.5` comme référence de release et de
service Render. Le dépôt est actuellement sur la branche `custom/local-friend-deployment`, qui
contient des commits plus récents (jusqu'au 14 août) absents de ce gel. Confirmez explicitement quelle
branche/tag sera réellement déployée pour la review — si c'est `custom/local-friend-deployment`, le
gel du 9 août est obsolète et doit être refait ; si c'est `marketplace/stable-prep`, vérifiez que les
correctifs du 14 août (dont un fix d'authentification uninstall/reinstall) y sont bien inclus, sinon
vous soumettriez une version sans ces correctifs.

**9. Le brouillon de Terms of Service contredit le code réel sur le billing.** Le document dit
« Billing is not enabled in the current marketplace readiness phase », alors que
`app/lib/billing.server.ts` est une implémentation complète et active (plans Solo/Growth/Multi-location,
vérification via l'API Partenaires, gestion d'erreurs typée, cache). Le document légal doit être mis à
jour avant publication pour refléter que la facturation est active.

**10. Le contrôle d'accès au billing dépend d'un jeton Partner API statique.** `getBillingState`
appelle `partners.shopify.com` avec `SHOPIFY_PARTNER_ACCESS_TOKEN` à chaque vérification (mise en
cache 30s), plutôt que l'API Admin du shop via la session authentifiée du marchand. Ce n'est pas
nécessairement un défaut — le code est défensif (timeout 5s, cache borné, tous les cas d'erreur
typés : throttled/timeout/http/graphql/malformed/network/shop_identity/authentication) — mais deux
points à confirmer : (a) ce jeton global doit être protégé et tourné avec le même soin qu'un secret
Shopify puisqu'il donne accès à la facturation de tous les marchands, et (b) ce modèle correspond-il
bien à ce que vous avez configuré côté Partner Dashboard (App Pricing géré par l'app vs. Managed
Pricing) ? Les deux modèles ont des exigences de review différentes.

## Moyen

**11. Je n'ai pas pu faire tourner `typecheck` ni `lint` dans cette session.** Les deux échouent sur
votre machine avec une erreur npm connue (bug de dépendances optionnelles npm/rollup sur arm64 +
`napi-postinstall: Permission denied`), pas une erreur de votre code. Avant de soumettre, lancez
vous-même : `rm -rf node_modules package-lock.json && npm install`, puis `npm run typecheck` et
`npm run lint`, pour avoir une vérification propre — je n'ai pas pu la faire à votre place ici.

**12. Le webhook `customers/data_request` ne déclenche aucune alerte automatique vers votre équipe.**
Il enregistre correctement l'événement (HMAC vérifié, réponse 200, aucune donnée client brute
loguée), mais tout repose ensuite sur une supervision manuelle de la table
`compliance_webhook_events` pour préparer l'export sous le délai Shopify de 30 jours. Fonctionnellement
conforme pour la review technique, mais fragile opérationnellement une fois en production —
envisagez une notification automatique (email/Slack) quand un événement `received` de ce type arrive.

**13. Code de permission mort et dupliqué.** `app/lib/permissions/location-access.ts`
(`getAllowedLocationsForUser`, `assertUserCanAccessLocation`) n'est appelé nulle part ailleurs dans le
repo — j'ai vérifié par grep sur tout `app/routes` et `app/lib`. Les deux routes de reporting
principales (`app.db-dashboard.tsx`, `app.locations.tsx`) utilisent bien
`resolveReportingScope` de `app/lib/auth/location-performance-access.ts`, correctement câblé côté
serveur — donc pas de faille active. Mais ce fichier mort utilise sa propre normalisation d'email
(`.trim().toLowerCase()` à la main) au lieu de la fonction canonique `normalizeShopOpsEmail` utilisée
partout ailleurs — à supprimer pour éviter qu'un futur développeur ne le réactive par erreur avec une
logique d'identité divergente.

**14. Documents de préparation marketplace désynchronisés entre eux.** `MARKETPLACE_READINESS.md`
(24 juin) affirme qu'aucune page légale/support publique n'existe et que le billing n'est pas
implémenté ; des documents plus récents (`MARKETPLACE_CHECKLIST.md`, `V0_FREEZE_2026-08-09.md`)
montrent le contraire. Ce n'est probablement que de la dérive documentaire normale, mais rien ne
marque `MARKETPLACE_READINESS.md` comme obsolète — un futur lecteur (ou vous, dans six mois) pourrait
s'y fier par erreur. De même, `MARKETPLACE_CHECKLIST.md` liste encore 7 captures d'écran comme non
faites alors que `V0_FREEZE_2026-08-09.md` dit 11 fichiers prêts à l'upload le même mois — probablement
juste le checklist non remis à jour après coup.

## Faible

**15. Branches marketplace obsolètes.** Plus de 50 branches `marketplace/phase-7*` existent encore en
local et sur origin. Aucun risque pour la review, mais un nettoyage post-lancement rendrait le dépôt
plus lisible.

**16. Fragmentation de version d'API déjà couverte en point bloquant n°2** — à traiter comme un seul
chantier (toml webhooks, client Admin GraphQL, extension POS) plutôt que trois correctifs séparés.

## Ce qui est solide

Pour équilibrer : plusieurs points que j'ai spécifiquement cherché à faire échouer ont résisté à la
vérification.

Les scopes publics (`read_orders, read_all_orders, read_products, read_inventory, read_locations`)
sont cohérents avec `SHOPIFY_SCOPES_JUSTIFICATION.md` et n'incluent pas `read_users`, qui est
correctement réservé à la config client interne — point historiquement délicat déjà bien résolu. Les
trois webhooks de conformité GDPR (`customers/data_request`, `customers/redact`, `shop/redact`) sont
implémentés via le SDK officiel Shopify (HMAC vérifié automatiquement), répondent 200/401
correctement, et `shop/redact` supprime les données sur 19 tables scopées par shop de façon complète.
Aucun secret n'a été trouvé committé dans le dépôt (grep ciblé sur tokens Shopify/clés privées/clé de
service Supabase : aucun résultat), et le `.gitignore` couvre correctement `.env*`, `/build`,
`.shopify/`. L'enforcement des permissions par emplacement est bien câblé côté serveur sur les deux
routes de reporting principales — vérifié par lecture directe, pas seulement déclaré. La logique
anti-collision d'identité (`duplicate-access.server.ts`) et le bootstrap du premier owner sont très
défensifs, avec plusieurs garde-fous, et aucun chemin d'auto-promotion abusif trouvé. Le module de
facturation gère proprement tous les cas d'erreur réseau/API avec cache borné et timeouts. L'extension
POS d'attribution vendeur est bien conçue (repli bulk→ligne par ligne, anti-rebond, aucune donnée
personnelle superflue exposée).

## Questions à trancher avec vous avant que je puisse dire « prêt à soumettre »

Je ne peux pas vérifier ces points depuis le code seul :

1. L'app Shopify dédiée, le service Render final et l'environnement Supabase dédié pour le marketplace
   sont-ils déjà créés, ou reste-t-il ce travail d'infra à faire (point bloquant 1) ?
2. L'approbation Shopify pour Protected Customer Data / `read_all_orders` a-t-elle été obtenue ?
3. Le test Lifecycle B (désinstallation réelle + `shop/redact`) du 11 août a-t-il été validé ?
4. Les documents Privacy Policy / ToS ont-ils été relus par un juriste, ou sont-ils toujours au stade
   brouillon trouvé dans le dépôt ?
5. Quelle branche/tag exact comptez-vous soumettre : `marketplace/stable-prep` @ `v0.1.0-rc.5` (le gel
   documenté), ou l'état actuel de `custom/local-friend-deployment` (qui contient des correctifs plus
   récents, jusqu'au 14 août) ?

## Recommandation Shopify à connaître

Shopify propose désormais un outil d'auto-review via la commande `/shopify-app-store-review` (CLI/agent)
qui valide automatiquement les exigences vérifiables par code avant la soumission formelle — utile en
complément de cet audit, pas à la place, puisqu'il ne couvre pas les points d'infra/légal/opérationnels
listés ci-dessus.

## Sources

- [About the app review process](https://shopify.dev/docs/apps/launch/app-store-review/review-process)
- [Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)
- [Checklist of requirements for apps in the Shopify App Store](https://shopify.dev/docs/apps/launch/app-requirements-checklist)
- [Built for Shopify requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)
- [Shopify App Store Guidelines checklist (third-party summary, cross-checked)](https://www.codersy.com/blog/shopify-api-development-best-practices/shopify-app-store-guidelines-key-requirements)
- Internal: `MARKETPLACE_READINESS.md`, `docs/marketplace/MARKETPLACE_CHECKLIST.md`,
  `docs/marketplace/FINAL_REVIEW_EXECUTION_STATUS.md`, `docs/marketplace/V0_FREEZE_2026-08-09.md`,
  `docs/marketplace/PARTNER_DASHBOARD_SUBMISSION_RUNBOOK.md`,
  `docs/marketplace/MARKETPLACE_ENVIRONMENT_SETUP.md`, `docs/marketplace/PRIVACY_POLICY_DRAFT.md`,
  `docs/marketplace/TERMS_OF_SERVICE_DRAFT.md`, `docs/marketplace/SUPPORT_AND_CONTACTS.md`,
  `docs/marketplace/SHOPIFY_SCOPES_JUSTIFICATION.md`, `app/shopify.server.ts`, `app/lib/billing.server.ts`,
  `app/lib/auth/*`, `app/lib/permissions/location-access.ts`, `app/routes/webhooks.*.tsx`,
  `app/lib/compliance/compliance-webhooks.server.ts`, `extensions/shopops-pos-attribution/*`,
  `shopify.app.shopops-marketplace.toml`, `.gitignore`.

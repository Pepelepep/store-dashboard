# Store_dashboard — État du projet et prochaines priorités

## 1. Objectif produit

Transformer l’app Shopify custom actuelle en un produit propre, standardisable et vendable :

**Shopify POS Intelligence for multi-location retailers**

Positionnement :

- ventes par boutique
- stocks par boutique
- COGS / marge / profitabilité
- dépenses fixes
- permissions par location
- Sync Center / fraîcheur des données
- staff sales si `read_users` est disponible
- plus tard : reporting flexible contrôlé

Le produit ne doit pas devenir un dashboard custom Local ni un BI tool complet. La cible reste :

**80% produit opinionated + 20% reporting flexible contrôlé**

---

## 2. Architecture actuelle

### Production client

- Store Shopify : `fh1z1f-5i.myshopify.com`
- App Shopify : `Store_dashboard`
- Render production : `https://store-dashboard-t530.onrender.com`
- Branche Git : `main`
- Supabase : projet production
- Shopify config : `shopify.app.store-dashboard.toml`

### Staging / dev

- Store Shopify : `seulementlocaldev.myshopify.com`
- Organisation : `ShopOps Studio`
- App Shopify : `Store_dashboard_staging`
- Render staging : `https://store-dashboard-sasm.onrender.com`
- Branche Git : `staging`
- Supabase staging : `nlatpbceauqzxrqdmqky`
- Shopify config : `shopify.app.store-dashboard-staging.toml`

### Environnements locaux

- `.env.production.local` : secrets production locaux
- `.env.staging.local` : secrets staging locaux
- `.env` : fichier temporaire actif localement
- `.env.example` : template sans secrets, versionné

Règle : Render n’utilise pas `.env`. Render utilise ses propres Environment Variables.

---

## 3. Ce qui est déjà validé

### Backend / data

- Dashboard DB-backed
- Supabase/Postgres comme base métier
- Sessions Shopify migrées de SQLite vers Supabase/Postgres
- Schema business versionné dans `supabase/migrations`
- Prisma conservé pour la table `Session`
- Environnements production/staging séparés

### Webhooks validés

- `orders/create`
- `orders/updated`
- `products/create`
- `products/update`
- `products/delete`
- `inventory_levels/update`
- `inventory_items/update`

### COGS

- Shopify Cost per item est lu via `InventoryItem.unitCost`
- `inventory_items/update` met à jour `variants.unit_cost`
- les `order_lines` liées sont recalculées
- le dashboard reflète le dernier COGS Shopify connu
- `cost_source = recomputed_from_current_variant_cost` quand recalculé

### Permissions

- Page permissions améliorée
- Shopify user ID obligatoire
- Add / Edit / Delete fonctionnels
- Permissions par location en place
- `read_users` pas encore utilisé en prod

### UI / staging

- App staging créée
- Supabase staging créé
- Schema staging créé
- Seed demo staging créé et appliqué
- Dashboard staging affiche des données mock

---

## 4. Points ouverts / problèmes connus

### 4.1 Staging Shopify réel

Le staging DB mock fonctionne, mais pour tester le vrai flow Shopify il faut encore :

1. Créer les locations dans Shopify Dev :
   - Downtown Montreal
   - CF Carrefour Laval
   - Vieux-Port
2. Importer les produits dans Shopify Dev via CSV
3. Nettoyer les données mock si on passe en mode Shopify réel
4. Sync depuis l’app staging :
   - locations
   - products
   - inventory
   - orders si commandes test

### 4.2 Protected customer data staging

Pour débloquer l’installation staging, les webhooks `orders/create` et `orders/updated` peuvent être temporairement retirés du TOML staging.

À terme, il faudra configurer l’accès protected customer data dans Shopify Dev Dashboard pour que staging reflète prod.

### 4.3 read_users / staff sales

Test GraphQL confirmé : les champs suivants sont bloqués sans `read_users` :

- `order.staffMember`
- `lineItems.staffMember`
- `transactions.user`

Shopify Support indique que `read_users` est probablement limité à Shopify Plus / conditions spécifiques. Local est actuellement sur Unlimited, pas Plus.

Alternative identifiée : rapport natif Shopify POS Pro :

- POS total sales by staff member
- Retail sales by staff attributed to sale

Mais l’objectif reste d’obtenir un accès automatique si Shopify active `read_users`.

### 4.4 Cron

L’endpoint existe :

`/api/cron/daily-sync`

Mais aucun cron réel n’est encore activé.

Les webhooks couvrent le near real-time. Le cron sera un filet de sécurité plus tard.

---

## 5. Priorités immédiates

## Priorité 1 — Finaliser l’environnement staging

Objectif : pouvoir développer sans toucher au dashboard client.

Actions :

1. Vérifier que Render staging utilise bien la branche `staging`
2. Vérifier les variables Render staging :
   - `SHOPIFY_APP_URL=https://store-dashboard-sasm.onrender.com`
   - clés Shopify staging
   - Supabase staging
   - `SYNC_SHOP_DOMAIN=seulementlocaldev.myshopify.com`
3. Installer / réinstaller l’app staging sur `SeulementLocalDev`
4. Vérifier Supabase staging table `Session`
5. Créer les locations Shopify Dev
6. Importer les produits Shopify Dev
7. Lancer les syncs staging

---

## Priorité 2 — Product UI Cleanup Sprint

Objectif : rendre l’interface propre, claire, Shopify-native, non custom Local.

Ordre recommandé :

1. Navigation cleanup
2. Dashboard polish
3. Sync Center polish
4. Permissions polish
5. Expenses polish
6. Settings page

### Navigation cible MVP

- Dashboard
- Expenses
- Sync Center
- Permissions
- Settings

Plus tard :

- Staff Sales
- Reports
- Recommendations
- Data Quality

---

## Priorité 3 — Settings page

Créer une page Settings pour sortir les règles métier du hardcode.

Settings MVP :

- default date range
- low stock threshold
- low margin threshold
- fallback gross margin
- sync mode / fréquence affichée
- note sur COGS
- location display names plus tard

---

## Priorité 4 — Staff Sales / read_users

Si Shopify active `read_users` :

1. Ajouter `read_users` au TOML staging d’abord
2. `shopify app deploy` staging
3. Réautoriser l’app staging
4. Tester :
   - `order.staffMember`
   - `lineItems.staffMember`
   - `transactions.user`
5. Ajouter table `staff_members`
6. Enrichir `syncOrders`
7. Créer page Staff Sales

Si Shopify refuse :

- garder staff sales comme module bloqué
- envisager import du rapport POS staff sales plus tard

---

## Priorité 5 — Multi-tenant foundation

Avant marketplace :

- créer / standardiser table `shops`
- ajouter progressivement `shop_id`
- garder `shop_domain` si utile, mais `shop_id` devient clé interne
- auditer toutes les requêtes serveur
- garantir qu’aucune donnée ne traverse les shops

Règle : chaque requête serveur doit filtrer par shop.

---

## 6. Workflow Git et déploiement

### Développement

```bash
git checkout staging
git pull origin staging
git checkout -b feature/my-feature
```

Après dev :

```bash
npm run typecheck
npm run build
git add .
git commit -m "..."
git checkout staging
git merge feature/my-feature
git push origin staging
```

Render staging déploie.

### Promotion production

Quand staging est validé :

```bash
git checkout main
git pull origin main
git merge staging
git push origin main
```

Render production déploie.

### Shopify deploy

Staging :

```bash
shopify app deploy --config shopify.app.store-dashboard-staging.toml
```

Production :

```bash
shopify app deploy --config shopify.app.store-dashboard.toml
```

---

## 7. Prochaine session — démarrage recommandé

Commencer par finir staging réel.

Checklist prochaine session :

1. Vérifier Render staging actif
2. Vérifier installation app staging
3. Vérifier Supabase staging `Session`
4. Créer locations Shopify Dev
5. Importer produits CSV Shopify Dev
6. Sync locations/products/inventory
7. Vérifier dashboard staging avec données Shopify réelles
8. Lancer audit UI cleanup

Ensuite seulement : Product UI Cleanup Sprint.

---

## 8. Règle de travail à partir de maintenant

Ne plus tester les gros changements sur Local production.

Tout changement produit passe par :

```txt
feature branch → staging → test SeulementLocalDev → main → Local production
```

Production Local sert uniquement à valider des bug fixes stables et les features déjà testées sur staging.


# Store Dashboard MVP — Shopify Embedded App

## 1. Purpose

This project is a Shopify embedded app MVP for store operations reporting.

The goal is to give store directors and managers a clear dashboard directly inside Shopify Admin, with data separated by Shopify location.

Example:

```text
Director → can view all authorized locations
Downtown manager → Downtown only
Laval manager → Laval only
Vieux-Port manager → Vieux-Port only
```

The dashboard is designed to answer:

```text
How much did this location sell?
What are the best sellers?
Which SKUs are close to stockout?
Which products are slow movers?
Which vendors are performing?
What should the store director monitor next?
```

---

## 2. Current MVP status

### Working

```text
✅ Shopify app created with React Router + TypeScript
✅ App linked to the Local Shopify organization
✅ App installed on the real Local Shopify store
✅ App opens inside Shopify Admin
✅ Shopify authentication works
✅ Real Shopify locations are retrieved
✅ Real inventory by location is retrieved
✅ Real orders are retrieved
✅ Orders are matched to retailLocation
✅ Live dashboard page exists
✅ Location selector exists
✅ Period selector exists: 7d / 30d / 90d
✅ Store manager insights added
```

### Current main route

```text
/app/live-dashboard
```

### Debug routes

```text
/app/debug/locations
/app/debug/inventory
/app/debug/orders
/app/debug/orders-locations
```

These debug routes are useful to validate Shopify API access before working on production metrics.

---

## 3. Current dashboard features

The current V0 dashboard shows real Shopify data by selected location.

### Filters

```text
Location selector
Period selector: Today / Last 7 days / Last 30 days / Last 90 days
```

### KPI cards

```text
Revenue
Orders
Units sold
Average order value
Inventory units
Critical SKUs
```

### Tables

```text
Best sellers
Soon out of stock
Sales by vendor
Slow movers
Recent order lines
```

### Current business assumption

```text
Sales source = Shopify retailLocation / POS location.
Online orders are not fully included in location views yet.
```

This is intentionally displayed in the dashboard to avoid misleading the store director.

---

## 4. Important current limitations

The MVP is valid as a technical/business proof of concept, but not yet production-grade.

```text
1. Shopify data is queried live from the dashboard.
2. Inventory queries are intentionally limited to avoid Shopify GraphQL query cost errors.
3. Orders are filtered by period, but the current query volume is still limited.
4. Sales are based on retailLocation only.
5. Online orders are not fully integrated yet.
6. Product costs and margins are not implemented yet.
7. Role-based location permissions are modeled, but not enforced from a production DB yet.
8. There is no production database yet.
9. Cloudflare quick tunnel is only for development, not production.
```

---

## 5. Current project structure

Important files:

```text
app/routes/app.live-dashboard.tsx
→ Main live dashboard page.

app/routes/app.debug.locations.tsx
→ Debug page for real Shopify locations.

app/routes/app.debug.inventory.tsx
→ Debug page for real Shopify inventory by location.

app/routes/app.debug.orders.tsx
→ Debug page for recent Shopify order lines.

app/routes/app.debug.orders-locations.tsx
→ Debug page for order attribution by retail location.

app/lib/graphql/locations.ts
→ Location GraphQL query foundation.

app/lib/graphql/products.ts
→ Product GraphQL query foundation.

app/lib/graphql/orders.ts
→ Order GraphQL query foundation.

app/lib/graphql/inventory.ts
→ Inventory GraphQL query foundation.

app/lib/metrics/location.ts
→ Helpers for filtering/grouping by location.

app/lib/metrics/sales.ts
→ Sales KPI calculation helpers.

app/lib/types/dashboard.ts
→ Dashboard data types.

app/lib/types/permissions.ts
→ User/location permission types.

app/lib/permissions/location-access.ts
→ Location access logic.

shopify.app.store-dashboard.toml
→ Shopify app config linked to the Local organization.

vite.config.ts
→ Includes allowedHosts for Cloudflare quick tunnels in development.

app/root.tsx
→ App root, Polaris provider and global setup.
```

---

## 6. Current Git context

Main branches used so far:

```text
feature/dashboard-v1
feature/dashboard-sections
feature/location-permissions
feature/live-dashboard-periods
```

Useful commands:

```bash
git status
git log --oneline --decorate --graph --all -n 20
npm run build
```

Before handing the project back to ChatGPT, provide:

```bash
git status
git log --oneline --decorate --graph --all -n 20
tree -L 3 app
cat package.json
cat shopify.app.store-dashboard.toml
```

Do not share `.env` or secrets.

---

## 7. How to test locally another day

### Terminal 1 — Start React Router app

```bash
cd ~/store-dashboard
set -a
source .env
set +a
npx react-router dev --host 127.0.0.1 --port 3000
```

Keep this terminal open.

### Terminal 2 — Start Cloudflare tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Copy the generated URL:

```text
https://xxxx.trycloudflare.com
```

### Update `.env`

```env
SHOPIFY_APP_URL=https://xxxx.trycloudflare.com
```

Keep:

```env
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SCOPES=read_all_orders,read_inventory,read_orders,read_products,read_locations
DATABASE_URL=file:./dev.sqlite
```

### Update `shopify.app.store-dashboard.toml`

```toml
application_url = "https://xxxx.trycloudflare.com"

[auth]
redirect_urls = [
  "https://xxxx.trycloudflare.com/auth/callback",
  "https://xxxx.trycloudflare.com/auth/shopify/callback",
  "https://xxxx.trycloudflare.com/api/auth/callback"
]
```

### Deploy Shopify app config

```bash
shopify app deploy
```

### Open the app in Shopify Admin

```text
Apps → Store_dashboard → Open application
```

Main dashboard:

```text
/app/live-dashboard
```

Debug pages:

```text
/app/debug/locations
/app/debug/inventory
/app/debug/orders
/app/debug/orders-locations
```

---

## 8. Recommended production architecture

The current app should move from direct live Shopify API queries to a database-backed model.

### Target architecture

```text
Shopify Admin embedded app
        ↓
React Router / Node app
        ↓
Shopify Admin GraphQL API
        ↓
Supabase / PostgreSQL
        ↓
Location-based dashboard
        ↓
User/location permission layer
```

### Why a database is needed

A production dashboard should not rely only on live Shopify GraphQL queries.

The database is needed to:

```text
- avoid Shopify GraphQL query cost limits
- store historical orders
- store inventory snapshots
- support fast period comparisons
- store user/location access rules
- store vendor/supplier rules
- calculate stock risk and reorder recommendations
- prepare margins and profitability
- support future multi-client SaaS usage
```

Shopify GraphQL Admin API has cost-based limits, and larger historical exports should use pagination or bulk operations instead of heavy live queries.

---

## 9. Recommended production database

Recommended choice:

```text
Supabase PostgreSQL
```

Why:

```text
- simple PostgreSQL setup
- fast to integrate
- good fit for BI-style queries
- easy hosted database
- can support future APIs, auth and scheduled jobs
- already aligned with previous Streamlit/Supabase project concepts
```

### Minimum production tables

```sql
shops
locations
products
variants
inventory_levels
orders
order_lines
user_location_access
sync_runs
```

### Later tables

```sql
vendor_rules
inventory_snapshots
margin_snapshots
recommendations
transfer_recommendations
```

---

## 10. User/location permission model

This is a key requirement.

The dashboard must not only filter by location in the frontend. It must enforce location access on the server.

### Required table

```sql
user_location_access
- id
- shop_domain
- shopify_user_id
- user_email
- location_id
- location_name
- role
- can_view
- created_at
```

### Roles

```text
admin
→ manage settings and permissions

director
→ view multiple or all locations

manager
→ view assigned store only

viewer
→ read-only access
```

### Security rule

```text
Never rely only on frontend hiding.
Always check permissions server-side before returning data.
```

Example:

```ts
if (!allowedLocationIds.includes(selectedLocationId)) {
  throw new Response("Forbidden", { status: 403 });
}
```

This avoids a manager changing the URL manually to view another location.

---

## 11. Production hosting options

The app needs a stable HTTPS URL in production.

Cloudflare quick tunnel is only for local development.

### Option A — Recommended MVP production stack

```text
App hosting: Render or Railway
Database: Supabase Pro
Jobs: Render cron / Railway cron / GitHub Actions initially
```

Why:

```text
- fastest path to production
- low DevOps complexity
- good enough for first client
- easy environment variable management
- easy GitHub deployment
```

Estimated cost:

```text
Render Starter or Railway Hobby/Pro: low to moderate monthly cost
Supabase Pro: production-ready baseline
Total early production estimate: roughly $30–$80/month depending on hosting choice, worker needs and usage
```

### Option B — More scalable but more technical

```text
App hosting: Fly.io or Google Cloud Run
Database: Supabase or managed Postgres
Jobs: Cloud Run jobs / Fly machines / queue worker
```

Why:

```text
- better scalability control
- stronger infrastructure options
- better for multi-client SaaS later
```

Tradeoff:

```text
- more DevOps work
- more deployment complexity
```

### Option C — Internal-only / demo

```text
Local machine + Cloudflare tunnel
```

Use only for:

```text
- demos
- internal testing
- development
```

Do not use for:

```text
- production
- directors relying on the tool daily
- client-facing stable delivery
```

---

## 12. Pricing / ease / scalability recommendations

### Supabase

Recommended for the database.

```text
Ease: High
Price: Low to moderate
Scalability: Good for MVP and early production
Recommendation: Use Supabase Pro for production, Free only for dev/testing
```

### Render

Good first production hosting choice.

```text
Ease: High
Price predictability: High
Scalability: Good for MVP and small production
Recommendation: Use Standard if Starter feels too small
```

### Railway

Good alternative for fast shipping.

```text
Ease: High
Price predictability: Medium
Scalability: Good for MVP and early production
Recommendation: Good if you want fast GitHub-based deploys and simple project management
```

### Fly.io

More technical, stronger infrastructure control.

```text
Ease: Medium
Price: Efficient for small always-on apps
Scalability: Good
Recommendation: Use later if you want more control or global deployment
```

### Recommended choice for this project

```text
Phase 1 production:
- Supabase Pro
- Render Standard or Railway Pro/Hobby depending usage
- one background sync worker
- one daily sync + manual refresh button

Phase 2:
- add hourly sync
- add queues/jobs
- add webhooks
- add multi-store/client support

Phase 3:
- add bulk operations for historical Shopify imports
- add margin and reorder logic
- add stock transfer recommendations
```

---

## 13. Production sync strategy

### V1

```text
Daily sync at night
Manual refresh button
Sync locations
Sync products
Sync variants
Sync inventory levels
Sync orders
Sync order lines
```

### V2

```text
Hourly sync
Webhooks for order creation/update
Inventory snapshots
Bulk operations for historical backfill
```

### Why not only live queries?

Live queries are useful for debugging and MVP validation, but not enough for production because:

```text
- Shopify query cost limits
- dashboard load time
- incomplete pagination
- harder historical comparisons
- no stable inventory snapshots
```

---

## 14. Business roadmap

### Phase 1 — Stabilize dashboard

```text
- validate current metrics
- improve UI
- add period comparisons
- confirm POS vs online rules
- implement DB schema
- enforce location permissions
```

### Phase 2 — Production data layer

```text
- sync Shopify to Supabase
- dashboard reads Supabase instead of Shopify live
- add manual refresh
- add sync status
- add error logs
```

### Phase 3 — Store director insights

```text
- best sellers
- soon out of stock
- slow movers
- sales by vendor
- low stock alerts
- period-over-period comparison
```

### Phase 4 — Profitability

```text
- product cost retrieval
- COGS
- gross profit
- gross margin %
- margin by product/vendor/location
```

### Phase 5 — Recommendations

```text
- reorder recommendations
- stock transfer recommendations between locations
- vendor lead time rules
- purchase planning
```

---

## 15. What to show the director

Suggested demo flow:

```text
1. Open Shopify Admin.
2. Open Store_dashboard.
3. Show location selector.
4. Switch between locations.
5. Show period selector: 7d / 30d / 90d.
6. Show Revenue / Orders / Units sold.
7. Show Best sellers.
8. Show Soon out of stock.
9. Show Slow movers.
10. Explain production roadmap:
   - DB
   - permissions
   - automated sync
   - recommendations
   - margins
```

Positioning:

```text
This MVP proves that we can build a location-based operational dashboard directly inside Shopify, using real Shopify data.

The next step is to make it production-ready with a database, permission rules, automated sync and more robust calculations.
```

---

## 16. Next recommended technical milestone

Create the production data layer.

Suggested next branch:

```bash
git checkout -b feature/supabase-data-model
```

Then implement:

```text
Supabase schema
Shop sync tables
Location permission table
Initial sync scripts
Dashboard query from database
Manual refresh button
```

Suggested commit:

```bash
git commit -m "Add Supabase production data model"
```

---

## 17. Quick commands reference

### Start dev app

```bash
cd ~/store-dashboard
set -a
source .env
set +a
npx react-router dev --host 127.0.0.1 --port 3000
```

### Start Cloudflare tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

### Build

```bash
npm run build
```

### Deploy Shopify app config

```bash
shopify app deploy
```

### Git

```bash
git status
git add .
git commit -m "Message"
```

### Useful project inspection for ChatGPT

```bash
git status
git log --oneline --decorate --graph --all -n 20
tree -L 3 app
cat package.json
cat shopify.app.store-dashboard.toml
```

Do not share `.env`.

---

## 18. Source notes

This README assumes the following external constraints:

```text
- Shopify embedded apps need a hosted web app URL for Shopify Admin to display the app.
- Shopify app configuration is deployed separately from the app web server.
- Shopify GraphQL Admin API has cost-based rate limits.
- Larger historical data imports should use pagination or Shopify Bulk Operations.
- Production should not rely on Cloudflare quick tunnels.
```

Always re-check official pricing and Shopify API docs before final client pricing or production deployment.

# Store Dashboard — Shopify Embedded App

## Project status

`Store_dashboard` is a Shopify embedded app for **Local**.

The app is installed on the real Local Shopify store and is built with:

```text
React Router
TypeScript
Shopify Admin GraphQL API
Supabase / PostgreSQL
Prisma session storage
```

The project started as a live Shopify API dashboard. It is now being moved to a **Supabase-backed production architecture** because live Shopify queries are limited by query cost, pagination, and performance constraints.

---

## Current architecture

```text
Shopify Admin embedded app
        ↓
React Router / Node app
        ↓
Shopify Admin GraphQL API
        ↓
Sync routes / future background jobs
        ↓
Supabase PostgreSQL
        ↓
DB-backed dashboard
        ↓
Server-side permissions by location
```

---

## Business goal

The dashboard must show store performance by Shopify location.

Example:

```text
Director / admin
→ can see all locations and consolidated totals

Store manager
→ can only see assigned locations

Viewer
→ read-only access
```

The dashboard should help answer:

```text
How much did this location sell?
What are the best sellers?
Which SKUs are close to stockout?
What are sales by vendor?
What are COGS, gross profit and gross margin?
What are fixed expenses and net profit?
Which orders/products need review?
```

---

## Current source of truth

The production direction is now:

```text
/app/db-dashboard
```

This should become the main dashboard.

The old live Shopify API dashboard:

```text
/app/live-dashboard
```

should redirect to `/app/db-dashboard` or eventually be removed/replaced.

The previous README still referenced `/app/live-dashboard` as the main route. That is now outdated.

---

## Main routes

### Dashboard

```text
/app/db-dashboard
```

Current DB-backed dashboard. Reads synced data from Supabase.

Expected sections:

```text
Header:
- Store dashboard
- Location dropdown on the right
- Start date / End date
- Today / Apply buttons
- Current location chip
- Range chip
- Days chip

KPI cards:
- Revenue
- Orders
- Units sold
- COGS
- Gross profit
- Gross margin
- Expenses
- Net profit

Tables:
- Best sellers
- Soon out of stock
- Sales by vendor
- Recent order lines
```

Recent order lines should include:

```text
Order link
Date
Product
SKU
Qty
Revenue
COGS
Gross profit
Cost source
```

---

## Admin / sync routes

```text
/app/admin/sync
```

Purpose:

```text
Light manual troubleshooting sync into Supabase
Track table counts
Track recent sync runs
Avoid live Shopify queries in dashboard
```

Primary full refresh command:

```text
npm run sync:local -- --shop fh1z1f-5i.myshopify.com --steps locations,products,inventory,orders
```

Default refresh order:

```text
1. Locations
2. Products & variants
3. Inventory
4. Orders / order lines
```

For targeted orders refreshes, use `--orders-start YYYY-MM-DD` and `--orders-end YYYY-MM-DD`.

---

## Debug routes

Keep temporarily during development:

```text
/app/debug/db
/app/debug/locations
/app/debug/inventory
/app/debug/orders
/app/debug/orders-locations
/app/debug/staff
```

Eventually, remove or protect these routes before production.

---

## Supabase project

Supabase project:

```text
Local_data
```

Project URL:

```text
https://zssifyxaubydqopifzjh.supabase.co
```

Expected env vars:

```env
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The app uses a server-side Supabase client:

```text
app/lib/db/supabase.server.ts
```

Because the project currently runs on Node 20, `ws` is installed and passed as the WebSocket transport for Supabase.

---

## Supabase tables

Current expected tables:

```text
shops
locations
products
variants
inventory_levels
orders
order_lines
fixed_expenses
user_location_access
sync_runs
```

---

## Deduplication / idempotent refresh

Refresh must be idempotent.

Clicking sync once or ten times should not duplicate business data.

Required unique indexes:

```text
locations:
shop_domain + shopify_location_id

products:
shop_domain + shopify_product_id

variants:
shop_domain + shopify_variant_id

inventory_levels:
shop_domain + shopify_location_id + inventory_item_id

orders:
shop_domain + shopify_order_id

order_lines:
shop_domain + shopify_line_item_id

user_location_access:
shop_domain + user_email + shopify_location_id
```

Important:

```text
sync_runs is a log table.
It should keep a new row for each refresh attempt.
Do not deduplicate sync_runs.
```

---

## Working syncs

### Locations

Working.

```text
Shopify locations → Supabase locations
```

Confirmed 7 locations synced.

### Products / variants

Working.

```text
Shopify products + variants + inventoryItem.unitCost
→ Supabase products / variants
```

`unit_cost` is needed for COGS and gross profit.

### Inventory

Working with batched strategy.

Do not use the heavy query:

```text
products → variants → inventoryItem → inventoryLevels
```

It can exceed Shopify GraphQL query cost limits.

Current approach:

```text
Supabase variants.inventory_item_id
        ↓
Shopify nodes(ids: [InventoryItem IDs])
        ↓
InventoryItem.inventoryLevels
        ↓
Supabase inventory_levels
```

### Orders / order_lines

Should use paginated sync, not only `orders(first: 100)`.

Requirements:

```text
- paginate all accessible orders
- optional startDate / endDate
- line item pagination for large orders
- upsert orders
- upsert order_lines
- compute revenue
- compute COGS
- compute gross profit
- store cost_source
```

---

## COGS / gross profit rules

For each order line:

```text
If Shopify unit_cost exists:
COGS = quantity × unit_cost
cost_source = SHOPIFY_UNIT_COST
```

For custom/manual sales without product cost:

```text
COGS = revenue × 50%
gross profit = revenue × 50%
cost_source = FALLBACK_50_PERCENT_CUSTOM_SALE
```

If no cost is available and it is not a clear custom/manual sale:

```text
COGS = null
gross_profit = null
cost_source = MISSING_COST
```

---

## Staff attribution status

Staff attribution is blocked for now.

The desired Shopify Analytics metric is:

```text
Assisting staff member name
```

Tried adding:

```text
read_users
```

but Shopify rejected the scope during deploy.

Current decision:

```text
Do not block MVP on Sales by staff.
Do not present Sales by staff as validated.
Keep as pending Shopify/admin approval or alternative source.
```

Possible future paths:

```text
1. Get read_users approved by Shopify/admin.
2. Find an alternative Shopify API source.
3. Use Shopify Analytics export if accessible.
4. Exclude Sales by staff from V1.
```

---

## Expenses

Expenses should not be hardcoded.

Need a DB-backed settings page.

Recommended route:

```text
/app/admin/expenses
```

or:

```text
/app/settings/expenses
```

Table:

```text
fixed_expenses
```

Rules:

```text
shopify_location_id null
→ global expense

shopify_location_id filled
→ location-specific expense

monthly_amount
→ prorated over selected dashboard range

net profit
→ gross profit - expenses
```

Until configured:

```text
Expenses = Not configured
Net profit = Not available
```

---

## Permissions

Need server-side permissions by location.

Table:

```text
user_location_access
```

Fields:

```text
shop_domain
user_email
shopify_user_id
shopify_location_id
location_name
role
can_view
can_manage
```

Roles:

```text
admin / director
→ all or multiple locations

manager
→ assigned location(s) only

viewer
→ read-only
```

Important rule:

```text
Never rely on frontend hiding only.
Always enforce location permissions in loaders/server-side queries.
```

Example:

```ts
if (!allowedLocationIds.includes(selectedLocationId)) {
  throw new Response("Forbidden", { status: 403 });
}
```

---

## Current project cleanup decision

Keep:

```text
app/routes/app.tsx
app/routes/app._index.tsx
app/routes/_index/route.tsx
app/routes/app.db-dashboard.tsx
app/routes/app.admin.sync.tsx
app/routes/app.admin.sync-locations.tsx
app/routes/app.admin.sync-products.tsx
app/routes/app.admin.sync-inventory.tsx
app/routes/app.admin.sync-orders.tsx
app/lib/db/supabase.server.ts
app/lib/permissions/location-access.ts
app/lib/types/permissions.ts
```

Keep temporarily:

```text
app/routes/app.debug.locations.tsx
app/routes/app.debug.inventory.tsx
app/routes/app.debug.orders.tsx
app/routes/app.debug.orders-locations.tsx
app/routes/app.debug.staff.tsx
```

Remove / legacy:

```text
app/routes/preview-dashboard.tsx
old live Shopify dashboard implementation once /app/live-dashboard redirects
app/.DS_Store
temporary duplicated docs inside app/docs if moved to /docs
```

Do not delete `shopify.app.toml` until config usage is confirmed.

---

## Local development

### Terminal 1 — React Router server

```bash
cd ~/store-dashboard
set -a
source .env
set +a
npx react-router dev --host 127.0.0.1 --port 3000
```

### Terminal 2 — Cloudflare tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

Copy the generated URL and update:

```env
SHOPIFY_APP_URL=https://xxxx.trycloudflare.com
```

Update:

```text
shopify.app.store-dashboard.toml
```

Then deploy config:

```bash
shopify app deploy
```

Cloudflare quick tunnels are for development only.

---

## Production direction

Cloudflare quick tunnel should be replaced by stable hosting.

Recommended MVP stack:

```text
Render or Railway
Supabase Pro
Shopify Dev Dashboard
local full refresh + webhooks
```

Later:

```text
webhooks
bulk operations
permissions admin UI
expenses settings page
```

---

## Useful commands for new conversation

Run and send these outputs:

```bash
cd ~/store-dashboard
git status
git log --oneline --decorate -n 20
find app/routes -maxdepth 2 -type f | sort
find app/lib -maxdepth 4 -type f | sort
cat package.json
cat shopify.app.store-dashboard.toml
cat .env | cut -d "=" -f 1
npm run build
```

Do not share `.env` values.

---

## Next recommended steps

1. Finish project cleanup.
2. Make `/app` and `/app/live-dashboard` redirect to `/app/db-dashboard`.
3. Make `/app/db-dashboard` visually match the final live dashboard UI.
4. Validate local full refresh in staging.
5. Improve Admin Sync troubleshooting UX/progress.
6. Add DB-backed expenses settings page.
7. Add server-side permissions.
8. Prepare Render/Railway production deploy.
9. Replace manual Cloudflare workflow.
10. Continue webhook and local bulk refresh hardening.

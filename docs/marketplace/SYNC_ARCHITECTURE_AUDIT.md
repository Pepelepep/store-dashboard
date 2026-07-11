# ShopOps synchronization architecture audit

Audited against the Phase 7N source on 2026-07-13. Labels below describe behavior traced from the route through the worker and persistence layer.

## Current architecture

```text
Merchant / initial setup             Shopify webhooks              Render cron
          |                                |                           |
          v                                v                           v
     sync_jobs                       webhook_events       POST maintenance-tick
          |                                |                 |    |    |    |
          +-------- bounded workers -------+-----------------+----+----+----+
                                           | webhooks | jobs | recovery
                                           | reconciliation | retention
                                           v
                                Shopify Admin GraphQL API
                                           |
                          idempotent Supabase upserts/replacement
                                           |
       locations, products, variants, inventory_levels, inventory_items,
       orders, order_lines, order_transactions, staff identity aliases,
                            sync_runs and automation state
```

## Pre-Phase-7N action audit

| Visible action / source         | Route and backend                                                         | Job / resources                                                                              | Range and Shopify query                                                                                  | Pagination                                                                                           | State, retry and history                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sync locations                  | `POST app.admin.sync` → `createManualSyncJob(locations)`                  | `locations`; locations only                                                                  | `locations(first: 50)`                                                                                   | Previously one page; Phase 7N follows `pageInfo.endCursor`                                           | `pending → running → success/error`; location sync writes its own `sync_runs` row                                  |
| Sync products                   | Same route, `products`                                                    | products and variants; later inventory resolves levels/cost                                  | `products(first: 20, after: cursor)`, variants 50 plus follow-up variant pages                           | Product cursor plus all variant pages                                                                | Worker records step counts and `sync_runs`; upsert by shop/product and shop/variant                                |
| Sync inventory                  | Same route, `inventory`                                                   | inventory item snapshots, variant cost, inventory levels, COGS recomputation                 | Reads stored variants in batches of 25, then `nodes(ids:)`; each item requests first 20 inventory levels | Database offset batches; Shopify inventory levels above 20 per item remain a limitation              | Idempotent keyed updates/upserts; job failure is terminal unless support retries                                   |
| Sync orders                     | Same route, `orders`                                                      | orders, lines, refunds/discounts/net sales, transactions, COGS, location and POS attribution | Seven-day `created_at` window through `orders(first: 50, sortKey: CREATED_AT, reverse: true)`            | Order cursor; line items 100 with follow-up pages; refunds/transactions have bounded follow-up pages | Upserts orders/lines/transactions; creates POS identity aliases; terminal step run                                 |
| “Full refresh job”              | Same route, `full`                                                        | locations → products → inventory → orders                                                    | Snapshot resources plus the same seven-day orders range                                                  | Per-resource behavior above                                                                          | One parent `sync_jobs` row; per-step `sync_runs`. It was not a historical refresh despite its label                |
| Process queued jobs now         | `POST app.admin.sync`, intent `process` → `processSyncJobsBatch(limit 5)` | Any pending marketplace job                                                                  | Executes the job’s configured queries                                                                    | Five batches per resource/tick, with persisted continuation                                          | Support action synchronously claims work using optimistic `updated_at`; not required when cron runs                |
| Legacy resource routes          | `/app/admin/sync-{orders,products,inventory,locations}`                   | None directly                                                                                | Redirect to `/app/admin/sync`                                                                            | N/A                                                                                                  | Compatibility only                                                                                                 |
| Initial install                 | `ensureShopInitialized`                                                   | Previously only inserted `shops`                                                             | No import was enqueued                                                                                   | N/A                                                                                                  | Phase 7N now enqueues one `full_refresh` with trigger `initial_setup`                                              |
| Order/product/inventory webhook | Authenticated webhook route → deduplicated `webhook_events` → processor   | One referenced order/product/inventory item/level                                            | Resource-by-ID GraphQL or direct inventory-level payload update                                          | Resource queries fetch remaining nested pages where implemented                                      | Shopify webhook ID unique per shop; DB claim uses `FOR UPDATE SKIP LOCKED`; five attempts with 5–60 minute backoff |
| Scheduled reconciliation        | Webhook processor previously bundled scheduling and execution             | `orders_reconciliation_48h`                                                                  | `updated_at` over 48 hours, 50 orders/page, replacement of current lines                                 | Order/nested pagination above                                                                        | Previously daily; Phase 7N checks every tick and makes each shop due every six hours                               |
| Financial backfill              | Protected internal endpoint                                               | `financial_backfill_30d`                                                                     | 30-day `created_at` order window                                                                         | Order pagination above                                                                               | Suppressed after a recent success unless forced                                                                    |

## Important findings

- “Full refresh” and normal full sync were aliases in practice; both used only seven days of orders. Phase 7N gives `full_refresh` an explicit unbounded historical order cursor while normal `full` retains the safe seven-day overlap.
- The old page showed five merchant actions, raw queue processing, current jobs, recent jobs, and `sync_runs` history. The jobs and runs represented parent and child views of the same work and produced duplicate merchant-facing history.
- No initial import was automatically enqueued when the shop row was first created.
- Reconciliation was coupled to webhook processing, ran daily, and also processed reconciliation jobs inside the webhook worker.
- Successful jobs, runs, and processed webhook events had no bounded retention cleanup.
- Location retrieval stopped at 50. Phase 7N adds cursor pagination.
- Order reconciliation deleted existing lines before replacement rows were safely upserted. Phase 7N upserts first and removes only stale line IDs afterward.
- Inventory requests only the first 20 levels per inventory item. Stores with an item stocked at more than 20 locations require a future nested inventory-level pagination improvement.
- The storage state names remain the compatible legacy values `pending/running/success/error/cancelled`; the merchant UI consistently translates these to `Queued/Syncing/Completed/Failed/Cancelled`.

## Final semantics

- **Sync now:** one `full` parent operation. Locations/products/inventory are refreshed as current snapshots; orders use a seven-day overlap and idempotent upserts. Existing active full/rebuild/resource work is reused rather than duplicated.
- **Rebuild data:** advanced-only confirmed `full_refresh`. It runs all resource steps and reads complete order history. It never truncates reporting tables; all records are upserted before stale reconciled lines are removed.
- **Process queue now:** advanced support-only execution of a bounded batch. Normal operation uses the maintenance cron.
- **Automatic reconciliation:** every installed offline-session shop is checked, a 48-hour updated-order overlap is due every six hours, and active/recent duplicate work is suppressed.
- **Recent activity:** `sync_jobs` is the parent operation authority. The merchant page requests 21 rows server-side, displays 20, and pages explicitly. `sync_runs` remains resource-level history used for freshness and diagnostics.

## Reliability and safety

- Job creation checks blocking job types and the partial unique index prevents duplicate active jobs of one type.
- Workers use optimistic claims (`id/status/updated_at`) so competing ticks cannot both own the same job.
- Large resource steps persist their cursor after five batches and return to the queue, bounding each tick without imposing a total-history page limit.
- Webhook claims use row locking with `SKIP LOCKED`; webhook IDs are unique per shop.
- Webhooks retry at most five times with bounded backoff. Stale jobs are recovered after 15 minutes and fail after three stale recoveries.
- All business writes are scoped by `shop_domain`. Orders, lines, products, variants and transactions use stable Shopify identifiers for idempotent upserts.
- Refunds, discount allocations, returns, net sales, COGS/cost-at-sale, location fields, custom POS line properties and effective seller attribution are rebuilt from the same order normalization path in all order modes.
- Cleanup is bounded to 500 records per tick. Successful operational records retain 30 days; cancelled jobs and failed runs retain 90 days. Unresolved failed jobs and failed webhook events are retained.

## Remaining risks

- Inventory-level nested pagination is still capped at 20 locations per item.
- Shopify refund and transaction nested pagination is deliberately bounded; extreme orders beyond those safety limits surface an error rather than looping indefinitely.
- `full_refresh` is safe and idempotent but can require multiple five-minute ticks for very large shops because each maintenance invocation is bounded.
- Job storage keeps legacy state names for endpoint and migration compatibility; changing physical values would require coordinated rollout across existing deployments.

# Phase 7P existing-store upgrade audit

Audited from the current branch on 2026-07-19. This describes source behavior; database object presence must be established with `PHASE_7P_PREFLIGHT.sql`.

## Open/install and initialization

1. Shopify's React Router package handles `/auth`, OAuth validation and creation/update of offline and online Prisma `Session` rows. The app uses expiring offline tokens. Reauthorization changes sessions, not Supabase shop/reporting identity.
2. `app.scopes_update` updates only the matching Prisma session's stored scope string. This phase does not change requested scopes and does not use `read_users`.
3. Every authenticated `/app` load calls `ensureShopInitialized` before billing and permission evaluation. Billing remains disabled when the existing marketplace preview environment says it is disabled.
4. Initialization looks up `public.shops` by unique `shop_domain`. It now uses insert-only creation: an existing row, ID, name and timestamps are not overwritten. A concurrent insert losing the unique race reuses the winner.
5. Until `shops.marketplace_initialized_at` is set, initialization checks the exact `shop_domain` across expenses, catalog, inventory, orders, transactions, staff identities and permissions. Those business footprints suppress fresh-install rebuild behavior, including for a V0 tenant whose `shops` row is unexpectedly absent. Operational-only sync runs/jobs and webhook records do not suppress the initial rebuild.
6. After classification, missing `sync_automation_state` and `pos_attribution_setup` rows are inserted with conflict-ignore semantics. Existing reconciliation timestamps/errors and POS `tile_confirmed_at` are preserved. A new POS setup row remains not configured (`tile_confirmed_at IS NULL`). The marker is written only after classification, mandatory setup and enqueue/reuse succeed, so an interrupted first load leaves it `NULL` and retries safely; later loads avoid repeating footprint queries.
7. Only a shop with no footprint requests an `initial_setup` `full_refresh` through the common job creator. Existing resource/full/rebuild/reconciliation/backfill work blocks it; raced requests reuse the active operation. The database's partial unique indexes remain the final concurrency guard.
8. Initialization does not write `staff_people`, `staff_identity_aliases`, or `user_location_access`. Staff/alias backfill happens only in additive migrations and uses deterministic email/user-ID matching plus unique keys. POS aliases arise from actual order metadata and never create dashboard authorization.

## Access compatibility

- Existing `user_location_access` rows remain authoritative and are never cleared during initialization or sync. Email and Shopify user ID matching are case/format normalized by the permission evaluator.
- Existing `admin`, `manager`, `viewer`, location grants, `can_view`, and `can_manage` values are preserved. A manager who is also a POS seller gets only the access already present in `user_location_access`; seller aliases add attribution, not authorization.
- When a shop has zero permission rows, the first identifiable Shopify session is a setup admin. This is existing bootstrap behavior. It does not run when any permission row already exists, so it cannot bypass an established permission set.
- If the current session exposes neither email nor Shopify user ID, admin access is rejected with an access-recovery message. OAuth/session identity availability remains a manual merchant-store validation point.

## Rebuild and overlap behavior

- `full_refresh` performs locations → products → inventory → orders and sets `orders.fullHistory=true`; normal `full` uses a seven-day order overlap.
- Cursors/progress and counts are stored in `sync_jobs`. Each pass is bounded; unfinished work returns to `pending`, so the maintenance cron continues it after the browser closes.
- The one-active-per-type index and the newer one-active-full-operation-per-shop index prevent concurrent `full`/`full_refresh`. The job creator also treats resource, reconciliation and financial-backfill work as blockers. Workers claim by `id + status + updated_at`, preventing cron/manual double ownership.
- Reporting writes use shop-scoped stable Shopify IDs and upserts: shop/order, shop/line, shop/product, shop/variant, inventory keys, transaction keys and identity-alias keys are unique. Order replacement upserts the incoming lines first and only then removes stale lines belonging to the fetched orders. It does not truncate historical order tables.
- `cost_at_sale` is preserved once captured; V2 COGS uses captured cost × quantity, otherwise stored COGS. Rebuild uses the approved common normalization path for discounts, returns, refunds, transactions, net sales and profit.
- V1 POS fields (`shopops_staff_member_id`, `shopops_user_id`, location/device/source) and V2 effective/attributed fields are read together. Orders without stamped metadata remain unattributed/Unassigned. Activating POS creates future attribution; it does not retroactively grant access or stamp previous orders.
- Stale running jobs return to pending and are eventually failed after the bounded retry count. Failed jobs are retained; retry creates/reuses a replacement job without deleting reporting data.

## Risks found and disposition

| Risk                                         | Before Phase 7P                                                                                                                | Disposition                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Legacy business rows but missing `shops` row | Misclassified as fresh; historical rebuild enqueued                                                                            | Fixed by footprint detection and insert-only shop creation.                                                                   |
| Simultaneous first app loads                 | Both callers reported a new shop and attempted direct job inserts                                                              | Fixed by insert race handling and shared blocking job creation; DB partial unique indexes remain required.                    |
| Existing shop missing automation/POS state   | Rows appeared only later through maintenance or Staff actions                                                                  | Fixed with conflict-ignore state creation that preserves existing values.                                                     |
| Existing shop row mutation                   | Upsert could update values during a race                                                                                       | Fixed with insert-only behavior; existing identity is untouched.                                                              |
| Concurrent permission replacement            | Legacy delete/insert saves had no strict canonical email identity key; whitespace/case and nullable fields weakened uniqueness | Fixed additively with trim/lower-normalized strict indexes that fail safely if pre-existing duplicates need investigation.    |
| Missing latest migration                     | Duplicate active full operations and unsupported `full_refresh` are possible                                                   | Not safely fixable in application code alone; preflight and ordered migration gate testing.                                   |
| Migration ledger unavailable                 | Cannot prove applied files from repository                                                                                     | Documented; catalog-based preflight is authoritative.                                                                         |
| Inventory at more than 20 locations          | Nested inventory level query is capped                                                                                         | Remaining known risk; compare inventory baseline and test representative items.                                               |
| Extreme refund/transaction pagination        | Deliberate bounds surface incomplete financial flags/errors                                                                    | Remaining known risk; financial QA and baseline comparison required.                                                          |
| Cleanup retention                            | Old successful operational history can be deleted after 30 days                                                                | Expected bounded cleanup; financial/reporting rows and unresolved failures are not deleted. Preserve QA snapshots externally. |

No approved financial formula, Shopify scope, billing behavior, POS V2 stamping, page naming, or client configuration was changed.

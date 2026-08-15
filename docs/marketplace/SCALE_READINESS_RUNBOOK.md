# ShopOps scale-readiness runbook

## Supported interactive envelope

- Reporting range: at most 366 days.
- Order lines loaded by one interactive report: at most 100,000 after the
  location, staff, vendor, and date filters have been applied in Postgres.
- Inventory rows loaded by one interactive report: at most 250,000.
- Report cache: 60 seconds per shop and applied filter set.

The application must fail with a clear limit message instead of returning a
partial financial result when one of these bounds is exceeded. Start a
pre-aggregation project before a merchant regularly reaches 70% of either row
limit; do not raise a limit without a production query plan and a heap/payload
measurement.

## Queue capacity and fairness

- Run `/internal/cron/maintenance-tick` every minute with `Authorization:
  Bearer $CRON_SECRET`.
- A database lease prevents overlapping maintenance ticks.
- One tick claims up to 100 webhook events and processes up to eight
  shop/resource lanes concurrently while preserving ordering inside a lane.
- One tick claims up to ten sync jobs and processes up to three shops
  concurrently while preserving ordering inside a shop.
- Reconciliation selects the 100 shops that are actually due; it never uses a
  fixed first page of installed shops.
- `shop/redact` acknowledges after durable enqueue. Maintenance purges the shop
  in repeatable 2,000-row table batches and records progress.

## Health checks and alerts

- Configure the hosting health check to use `/healthz`.
- Monitor `/internal/health/operations` with the same bearer secret at least
  every five minutes.
- Alert on any non-200 response. The endpoint reports only aggregate state and
  returns 503 for:
  - maintenance older than 10 minutes;
  - oldest pending webhook older than 15 minutes;
  - oldest pending sync job older than 30 minutes;
  - oldest pending redaction older than 60 minutes;
  - any terminal webhook error.
- Alert separately on deploy preflight failure. Application startup checks the
  required Supabase schema version before accepting traffic.

## Release acceptance scenarios

Run these after applying the database migration and before promoting the app:

1. Open Dashboard and Compare Locations for all permitted locations over 60
   days, then 366 days. Apply a staff filter and a vendor filter separately and
   together. No result may be partial.
2. Verify the previous-period comparison uses the immediately preceding period
   with the same filters.
3. Verify an order with a Shopify `cost per item` has actual COGS after sync;
   verify a genuinely missing cost uses the configured estimate and does not
   block reported gross profit.
4. Import a Shopify staff CSV before any matching tracked sale exists. The
   people must remain importable; later sales reconcile to their identities.
5. Enqueue duplicate operational webhooks. Both deliveries must be
   acknowledged and the event must be processed once.
6. Start two maintenance calls together. Exactly one acquires the lease; the
   other exits cleanly.
7. Enqueue a test redaction in a disposable shop fixture. The webhook must
   return immediately and repeated ticks must finish the purge idempotently.

## Database review after each scale migration

- Confirm the required schema version is present.
- Confirm the reporting, queue, and foreign-key indexes exist and duplicate
  indexes do not.
- Run Supabase security and performance advisors. A service-only table with RLS
  and no client policy is intentional; review all warnings rather than blindly
  suppressing or deleting newly created indexes before they have traffic.
- Review queue age, deadlocks, temp-file growth, active connections, and slow
  reporting query plans.


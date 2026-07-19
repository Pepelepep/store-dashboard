# Phase 7P rollback and recovery

This is an operational rollback, not an automatic data rollback. Preserve the pre-upgrade snapshot and baseline output throughout.

## Stop processing safely

1. Pause the Render cron invoking the maintenance endpoint. Record the pause time and the latest `maintenance_tick_state` row.
2. Prevent new manual operations by restricting merchant access to the marketplace preview or deploying the previous stable-prep application revision. Do not delete queue rows. If webhook ingestion must also stop, restrict the preview service at the platform level only after recording the impact; Shopify will retry webhooks.
3. Identify active work read-only:

```sql
SELECT id, shop_domain, job_type, status, current_step, progress, counts,
       details, created_at, started_at, updated_at
FROM public.sync_jobs
WHERE shop_domain = '<SHOP_DOMAIN>' AND status IN ('pending','running')
ORDER BY created_at;
```

4. Do not manually mark a recently running job failed while a worker could still own it. After cron/web traffic is stopped, retain the row and its cursor for diagnosis. A stale job can be recovered by the prior/current supported worker after rollback.

## Application rollback

The audited pre-Phase-7P stable-prep commit is `1a26afb` (`Merge staff identity and order UX improvements`). Redeploy that exact commit through the normal Render release mechanism; do not merge this branch or rewrite production/client branches. Confirm its environment still points to the intended marketplace Shopify, Prisma and Supabase databases.

Additive database objects should normally remain. The old application ignores them, while dropping columns, indexes or functions can destroy evidence and block forward recovery. If a new additive repair migration is later introduced, roll its behavior back with a separately reviewed forward migration only after a snapshot.

## Compare and recover

1. Run `PHASE_7P_BASELINE.sql` with the same shop and retain raw output. Compare every count/amount to the pre-upgrade output and the recorded V0 dashboard totals. Explain expected Shopify changes that occurred during the window; unexplained decreases or duplicate increases fail rollback validation.
2. Inspect failed jobs and events:

```sql
SELECT id, job_type, status, current_step, error_message, details, progress, updated_at
FROM public.sync_jobs
WHERE shop_domain='<SHOP_DOMAIN>' AND status='error'
ORDER BY updated_at DESC;

SELECT id, topic, status, attempts, last_error, received_at, available_at
FROM public.webhook_events
WHERE shop_domain='<SHOP_DOMAIN>' AND status='error'
ORDER BY received_at;
```

3. Fix the underlying schema/token/API issue first. Resume cron and let cursor-bearing pending work continue. Retry a failed job from Advanced diagnostics only once; job blocking and unique indexes should reuse any equivalent active work.
4. Confirm the offline Prisma session exists before resuming cron. Reauthorize through Shopify if the token is invalid; never copy tokens between apps or shops.
5. Resume cron, observe at least two successful maintenance ticks, then repeat the baseline and dashboard comparison.
6. Run `PHASE_7P_POSTFLIGHT.sql`. Do not declare recovery complete while it reports `BLOCKED`; record and explicitly accept any remaining `WARNING`.

## Actions that must never be taken

- Never delete/truncate historical orders, lines, transactions, costs, staff, permissions or jobs as a rollback shortcut.
- Never replay `001_initial_business_schema.sql` on an existing database or edit an applied migration.
- Never remove duplicate-looking rows before proving their Shopify IDs, shop scope and uniqueness constraints.
- Never rewrite `cost_at_sale`, refunds, returns or discounts to force totals to match.
- Never map a POS seller to dashboard access automatically.
- Never run `shop/redact`, compliance deletion, seed scripts or destructive resets during upgrade recovery.
- Never resume cron against a partially migrated job-type constraint.

# Render cron setup

Create one Render Cron Job:

- Name: `shopops-maintenance-tick`
- Branch: `marketplace/stable-prep`
- Schedule: `* * * * *`
- Command: `npm run cron:maintenance`

Required environment variables:

- `SHOPIFY_APP_URL`: deployed HTTPS app origin, without a path.
- `CRON_SECRET`: the same strong secret configured on the web service.

The repository script sends `POST ${SHOPIFY_APP_URL}/internal/cron/maintenance-tick` with the bearer credential, fails on a non-success response, prints only a concise result, and never prints the secret.

The endpoint uses a database lease, so an overlapping invocation exits safely. It performs bounded concurrent webhook processing, cross-shop sync processing, durable shop-redaction work, stale recovery, fair due-shop reconciliation scheduling, and history cleanup. Existing cron endpoints remain temporarily compatible but should not be scheduled alongside this job.

Configure the web service health check path as `/healthz`, and monitor
`/internal/health/operations` with the same bearer secret at least every five
minutes. The complete thresholds and release scenarios are documented in
`SCALE_READINESS_RUNBOOK.md`.

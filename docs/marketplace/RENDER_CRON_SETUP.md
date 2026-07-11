# Render cron setup

Create one Render Cron Job:

- Name: `shopops-maintenance-tick`
- Branch: `marketplace/stable-prep`
- Schedule: `*/5 * * * *`
- Command: `npm run cron:maintenance`

Required environment variables:

- `SHOPIFY_APP_URL`: deployed HTTPS app origin, without a path.
- `CRON_SECRET`: the same strong secret configured on the web service.

The repository script sends `POST ${SHOPIFY_APP_URL}/internal/cron/maintenance-tick` with the bearer credential, fails on a non-success response, prints only a concise result, and never prints the secret.

The endpoint performs bounded webhook processing, sync-job processing, stale recovery, reconciliation scheduling, and history cleanup. Existing cron endpoints remain temporarily compatible but should not be scheduled alongside this job.

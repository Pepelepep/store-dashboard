import process from "node:process";

const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;

if (!appUrl || !cronSecret) {
  console.error("Missing SHOPIFY_APP_URL or CRON_SECRET.");
  process.exit(1);
}

try {
  const response = await fetch(`${appUrl}/internal/cron/maintenance-tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`Maintenance tick failed (${response.status}).`);
    process.exit(1);
  }
  const failedSteps = Array.isArray(body?.failedSteps)
    ? body.failedSteps.length
    : 0;
  console.log(
    `Maintenance tick complete; ${failedSteps} step(s) reported an error.`,
  );
} catch (error) {
  console.error(
    `Maintenance tick request failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const defaultSteps = ["locations", "products", "inventory", "orders"] as const;
type RefreshStep = (typeof defaultSteps)[number];

type ParsedArgs = {
  shop: string;
  steps: RefreshStep[];
  ordersStart?: string | null;
  ordersEnd?: string | null;
};

type SyncResult = Record<string, unknown>;

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (!key || key in process.env) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(`Error: ${message}`);
  }

  console.error(
    [
      "Usage:",
      "  npm run sync:local -- --shop fh1z1f-5i.myshopify.com",
      "",
      "Options:",
      "  --steps locations,products,inventory,orders",
      "  --shop fh1z1f-5i.myshopify.com",
      "  --orders-start YYYY-MM-DD",
      "  --orders-end YYYY-MM-DD",
    ].join("\n"),
  );

  process.exit(1);
}

function parseDateOption(name: string, value?: string) {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    printUsageAndExit(`${name} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    printUsageAndExit(`${name} is not a valid calendar date.`);
  }

  return value;
}

function parseSteps(value?: string): RefreshStep[] {
  if (!value) {
    return [...defaultSteps];
  }

  const requestedSteps = value
    .split(",")
    .map((step) => step.trim())
    .filter(Boolean);

  if (requestedSteps.length === 0) {
    printUsageAndExit("--steps must include at least one step.");
  }

  const validSteps = new Set<string>(defaultSteps);
  const invalidSteps = requestedSteps.filter((step) => !validSteps.has(step));

  if (invalidSteps.length > 0) {
    printUsageAndExit(`Unknown step(s): ${invalidSteps.join(", ")}`);
  }

  return requestedSteps as RefreshStep[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      printUsageAndExit(`Unexpected argument: ${arg}`);
    }

    const inlineEqualsIndex = arg.indexOf("=");

    if (inlineEqualsIndex !== -1) {
      values.set(
        arg.slice(2, inlineEqualsIndex),
        arg.slice(inlineEqualsIndex + 1),
      );
      continue;
    }

    const key = arg.slice(2);
    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      printUsageAndExit(`Missing value for --${key}.`);
    }

    values.set(key, nextValue);
    index += 1;
  }

  const supportedOptions = new Set([
    "steps",
    "shop",
    "orders-start",
    "orders-end",
  ]);
  const unknownOptions = Array.from(values.keys()).filter(
    (key) => !supportedOptions.has(key),
  );

  if (unknownOptions.length > 0) {
    printUsageAndExit(`Unknown option(s): ${unknownOptions.join(", ")}`);
  }

  const shop = values.get("shop") ?? process.env.SYNC_SHOP_DOMAIN;

  if (!shop) {
    printUsageAndExit("Missing --shop or SYNC_SHOP_DOMAIN.");
  }

  return {
    shop,
    steps: parseSteps(values.get("steps")),
    ordersStart: parseDateOption("--orders-start", values.get("orders-start")),
    ordersEnd: parseDateOption("--orders-end", values.get("orders-end")),
  };
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function printCounts(result: SyncResult) {
  const entries = Object.entries(result).filter(
    ([, value]) =>
      value === null || ["string", "number", "boolean"].includes(typeof value),
  );

  if (entries.length === 0) {
    console.log("  counts: none reported");
    return;
  }

  console.log("  counts:");

  for (const [key, value] of entries) {
    console.log(`    ${key}: ${String(value)}`);
  }
}

async function main() {
  loadLocalEnv();

  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const [{ getOfflineAdminClient }, { getSupabaseAdminClient }, syncModule] =
    await Promise.all([
      import("../app/lib/shopify/offline-admin.server"),
      import("../app/lib/db/supabase.server"),
      import("../app/lib/sync/shopify-sync.server"),
    ]);

  const admin = await getOfflineAdminClient(args.shop);
  const supabase = getSupabaseAdminClient();
  const source = "local_manual_refresh";

  console.log("Local Shopify/Supabase refresh");
  console.log(`shop: ${args.shop}`);
  console.log(`source: ${source}`);
  console.log(`steps: ${args.steps.join(" -> ")}`);

  for (const step of args.steps) {
    const stepStartedAt = Date.now();

    console.log(`\nstarted step: ${step}`);

    try {
      let result: SyncResult;

      if (step === "locations") {
        result = await syncModule.syncLocations({
          admin,
          shop: args.shop,
          supabase,
          source,
        });
      } else if (step === "products") {
        result = await syncModule.syncProducts({
          admin,
          shop: args.shop,
          supabase,
          source,
        });
      } else if (step === "inventory") {
        result = await syncModule.syncInventory({
          admin,
          shop: args.shop,
          supabase,
          source,
        });
      } else {
        result = await syncModule.syncOrders({
          admin,
          shop: args.shop,
          supabase,
          source,
          startDate: args.ordersStart,
          endDate: args.ordersEnd,
        });
      }

      console.log(`completed step: ${step}`);
      printCounts(result);
      console.log(`  duration: ${formatDuration(Date.now() - stepStartedAt)}`);
    } catch (error) {
      console.error(`failed step: ${step}`);
      console.error(
        `  duration: ${formatDuration(Date.now() - stepStartedAt)}`,
      );
      console.error(
        `  error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      process.exit(1);
    }
  }

  console.log(
    `\nrefresh completed in ${formatDuration(Date.now() - startedAt)}`,
  );
}

void main().catch((error) => {
  console.error("Local refresh failed before a step could start.");
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});

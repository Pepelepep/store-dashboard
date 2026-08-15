import process from "node:process";
import { createClient } from "@supabase/supabase-js";

export const REQUIRED_SCHEMA_VERSION =
  "20260815173141_scale_foundation_queues_and_indexes";

export async function verifySupabaseSchema({
  url = process.env.SUPABASE_URL,
  key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required.",
    );
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("shopops_schema_versions")
    .select("version")
    .eq("version", REQUIRED_SCHEMA_VERSION)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase schema preflight failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `Supabase schema is missing required version ${REQUIRED_SCHEMA_VERSION}. Apply migrations before deploying the application.`,
    );
  }

  return REQUIRED_SCHEMA_VERSION;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const version = await verifySupabaseSchema();
    console.log(`Supabase schema verified: ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

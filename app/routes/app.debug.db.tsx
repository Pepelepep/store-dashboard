import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type LoaderData = {
  shop: string;
  ok: boolean;
  tables: {
    table: string;
    rowsCount: number;
    error?: string;
  }[];
};

async function getTableCount(
  table: string,
  shop: string,
  supabase: ReturnType<typeof getSupabaseAdminClient>,
) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", shop);

  return {
    table,
    rowsCount: count ?? 0,
    error: error?.message,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const tables = await Promise.all([
    getTableCount("locations", session.shop, supabase),
    getTableCount("products", session.shop, supabase),
    getTableCount("variants", session.shop, supabase),
    getTableCount("inventory_levels", session.shop, supabase),
    getTableCount("orders", session.shop, supabase),
    getTableCount("order_lines", session.shop, supabase),
    getTableCount("fixed_expenses", session.shop, supabase),
    getTableCount("user_location_access", session.shop, supabase),
  ]);

  return {
    shop: session.shop,
    ok: tables.every((table) => !table.error),
    tables,
  };
}

export default function DebugDbPage() {
  const data = useLoaderData<LoaderData>();

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <h1>Debug DB</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
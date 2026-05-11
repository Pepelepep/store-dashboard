import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type LoaderData = {
  shop: string;
  ok: boolean;
  table: string;
  rowsCount: number;
  error?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const { count, error } = await supabase
    .from("locations")
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", session.shop);

  return {
    shop: session.shop,
    ok: !error,
    table: "locations",
    rowsCount: count ?? 0,
    error: error?.message,
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
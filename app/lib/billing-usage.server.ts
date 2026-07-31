import type { SupabaseClient } from "@supabase/supabase-js";

import {
  countActiveDashboardUsers,
  type BillingUsage,
  type DashboardUserRow,
} from "./billing.server";
import { fetchAllSupabasePages } from "./db/supabase-pagination.server";

export async function getDashboardUserRows({
  supabase,
  shop,
}: {
  supabase: SupabaseClient;
  shop: string;
}) {
  return fetchAllSupabasePages<DashboardUserRow>({
    label: "Billing dashboard users",
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("user_location_access")
        .select("id, access_label, user_email, shopify_user_id")
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: DashboardUserRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

export async function getBillingUsage({
  supabase,
  shop,
}: {
  supabase: SupabaseClient;
  shop: string;
}): Promise<BillingUsage> {
  const [locationsResult, dashboardUserRows] = await Promise.all([
    supabase
      .from("locations")
      .select("*", { count: "exact", head: true })
      .eq("shop_domain", shop)
      .eq("is_active", true),
    getDashboardUserRows({ supabase, shop }),
  ]);

  if (locationsResult.error) {
    throw new Error(locationsResult.error.message);
  }
  return {
    activeLocations: locationsResult.count ?? 0,
    dashboardUsers: countActiveDashboardUsers(dashboardUserRows),
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingUsage } from "./billing.server";

export async function getBillingUsage({
  supabase,
  shop,
}: {
  supabase: SupabaseClient;
  shop: string;
}): Promise<BillingUsage> {
  const [locationsResult, membershipsResult] = await Promise.all([
    supabase
      .from("locations")
      .select("*", { count: "exact", head: true })
      .eq("shop_domain", shop)
      .eq("shopify_is_active", true)
      .eq("reporting_enabled", true),
    supabase
      .from("dashboard_memberships")
      .select("*", { count: "exact", head: true })
      .eq("shop_domain", shop)
      .eq("status", "active"),
  ]);

  if (locationsResult.error) {
    throw new Error(locationsResult.error.message);
  }
  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message);
  }
  return {
    activeLocations: locationsResult.count ?? 0,
    dashboardUsers: membershipsResult.count ?? 0,
  };
}

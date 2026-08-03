import type { LoaderFunctionArgs } from "react-router";

import { assertCapabilityAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { loadMissingProductCostsPage } from "../lib/financial/cogs-setup.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.setup.missing-products",
    shop: session.shop,
    supabase,
  });
  await assertCapabilityAccess({
    capability: "manage_costs",
    request,
    route: "app.admin.setup.missing-products",
    session,
    supabase,
  });

  const url = new URL(request.url);

  return loadMissingProductCostsPage({
    supabase,
    shop: session.shop,
    page: Number(url.searchParams.get("page") ?? 1),
    search: url.searchParams.get("search") ?? "",
  });
}

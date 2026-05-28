import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

async function redirectToSyncCenter(request: Request) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const url = new URL(request.url);

  return redirect(`/app/admin/sync${url.search}`);
}

export async function loader({ request }: LoaderFunctionArgs) {
  return redirectToSyncCenter(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return redirectToSyncCenter(request);
}

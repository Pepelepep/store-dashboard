import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

function staffPath(request: Request) {
  const url = new URL(request.url);
  return `/app/admin/staff${url.search}`;
}

async function requireAccessAndRedirect(request: Request) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await assertAdminAccess({ request, session, supabase });
  throw redirect(staffPath(request));
}

export function loader({ request }: LoaderFunctionArgs) {
  return requireAccessAndRedirect(request);
}

export function action({ request }: ActionFunctionArgs) {
  return requireAccessAndRedirect(request);
}

export default function LegacyTeamAccessRedirect() {
  return null;
}

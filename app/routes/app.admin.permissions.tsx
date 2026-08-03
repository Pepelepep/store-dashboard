import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { assertCapabilityAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

function peopleAccessPath(request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("tab", "access");
  return `/app/people?${url.searchParams.toString()}`;
}

async function requireAccessAndRedirect(request: Request) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await assertCapabilityAccess({
    capability: "manage_people",
    request,
    route: "app.admin.permissions",
    session,
    supabase,
  });
  throw redirect(peopleAccessPath(request));
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

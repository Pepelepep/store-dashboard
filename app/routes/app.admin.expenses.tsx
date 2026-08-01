import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.searchParams);
  searchParams.set("tab", "expenses");

  throw redirect(`/app/costs?${searchParams.toString()}`);
}

export default function AdminExpensesRedirect() {
  return null;
}

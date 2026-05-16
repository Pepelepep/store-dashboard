import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";

type LocationRow = {
  shopify_location_id: string;
  name: string;
};

type ExpenseRow = {
  id: string;
  shop_domain: string;
  shopify_location_id: string | null;
  location_name: string | null;
  expense_name: string;
  expense_category: string | null;
  monthly_amount: number;
  start_month: string;
  end_month: string | null;
  is_active: boolean;
};

type LoaderData = {
  shop: string;
  locations: LocationRow[];
  expenses: ExpenseRow[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const [{ data: locationsData, error: locationsError }, { data: expensesData, error: expensesError }] =
    await Promise.all([
      supabase
        .from("locations")
        .select("shopify_location_id, name")
        .eq("shop_domain", session.shop)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("fixed_expenses")
        .select(
          "id, shop_domain, shopify_location_id, location_name, expense_name, expense_category, monthly_amount, start_month, end_month, is_active",
        )
        .eq("shop_domain", session.shop)
        .order("start_month", { ascending: false })
        .order("expense_name", { ascending: true }),
    ]);

  if (locationsError) throw new Response(locationsError.message, { status: 500 });
  if (expensesError) throw new Response(expensesError.message, { status: 500 });

  return {
    shop: session.shop,
    locations: (locationsData ?? []) as LocationRow[],
    expenses: (expensesData ?? []) as ExpenseRow[],
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) throw new Response("Missing expense id", { status: 400 });

    const { error } = await supabase
      .from("fixed_expenses")
      .delete()
      .eq("shop_domain", session.shop)
      .eq("id", id);

    if (error) throw new Response(error.message, { status: 500 });

    return { ok: true };
  }

  if (intent === "toggle") {
    const id = String(formData.get("id") ?? "");
    const isActive = String(formData.get("is_active") ?? "false") === "true";

    const { error } = await supabase
      .from("fixed_expenses")
      .update({
        is_active: !isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("shop_domain", session.shop)
      .eq("id", id);

    if (error) throw new Response(error.message, { status: 500 });

    return { ok: true };
  }

  const expenseName = String(formData.get("expense_name") ?? "").trim();
  const expenseCategory = String(formData.get("expense_category") ?? "").trim() || null;
  const monthlyAmount = Number(formData.get("monthly_amount") ?? 0);
  const startMonth = String(formData.get("start_month") ?? "");
  const endMonthRaw = String(formData.get("end_month") ?? "").trim();
  const endMonth = endMonthRaw || null;
  const shopifyLocationIdRaw = String(formData.get("shopify_location_id") ?? "").trim();
  const shopifyLocationId = shopifyLocationIdRaw || null;

  if (!expenseName) throw new Response("Expense name is required", { status: 400 });
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) {
    throw new Response("Monthly amount must be valid", { status: 400 });
  }
  if (!startMonth) throw new Response("Start month is required", { status: 400 });

  let locationName: string | null = null;

  if (shopifyLocationId) {
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("name")
      .eq("shop_domain", session.shop)
      .eq("shopify_location_id", shopifyLocationId)
      .maybeSingle();

    if (locationError) throw new Response(locationError.message, { status: 500 });
    locationName = location?.name ?? null;
  }

  const payload = {
    shop_domain: session.shop,
    shopify_location_id: shopifyLocationId,
    location_name: locationName,
    expense_name: expenseName,
    expense_category: expenseCategory,
    monthly_amount: monthlyAmount,
    start_month: `${startMonth}-01`,
    end_month: endMonth ? `${endMonth}-01` : null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const id = String(formData.get("id") ?? "").trim();

  const { error } = id
    ? await supabase
        .from("fixed_expenses")
        .update(payload)
        .eq("shop_domain", session.shop)
        .eq("id", id)
    : await supabase.from("fixed_expenses").insert(payload);

  if (error) throw new Response(error.message, { status: 500 });

  return { ok: true };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatMonth(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 7);
}

export default function AdminExpensesPage() {
  const { shop, locations, expenses } = useLoaderData<LoaderData>();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f6f7",
        padding: 28,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ color: "#616161", fontSize: 14, marginBottom: 6 }}>
            Admin
          </div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Fixed expenses</h1>
          <p style={{ color: "#616161" }}>
            Shop: <strong>{shop}</strong>
          </p>
        </header>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Add expense</h2>

          <Form method="post">
            <input type="hidden" name="intent" value="save" />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 14,
              }}
            >
              <label>
                Name
                <input name="expense_name" required style={{ width: "100%", padding: 10 }} />
              </label>

              <label>
                Category
                <input name="expense_category" placeholder="Rent, staff, software..." style={{ width: "100%", padding: 10 }} />
              </label>

              <label>
                Monthly amount
                <input name="monthly_amount" type="number" min="0" step="0.01" required style={{ width: "100%", padding: 10 }} />
              </label>

              <label>
                Start month
                <input name="start_month" type="month" required style={{ width: "100%", padding: 10 }} />
              </label>

              <label>
                End month
                <input name="end_month" type="month" style={{ width: "100%", padding: 10 }} />
              </label>

              <label>
                Location
                <select name="shopify_location_id" style={{ width: "100%", padding: 10 }}>
                  <option value="">Global / all locations</option>
                  {locations.map((location) => (
                    <option key={location.shopify_location_id} value={location.shopify_location_id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              style={{
                marginTop: 16,
                background: "#202223",
                color: "white",
                border: "1px solid #202223",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Save expense
            </button>
          </Form>
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Current expenses</h2>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {["Name", "Category", "Location", "Monthly amount", "Start", "End", "Active", "Actions"].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{expense.expense_name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{expense.expense_category ?? "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{expense.location_name ?? "Global"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{formatCurrency(Number(expense.monthly_amount ?? 0))}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{formatMonth(expense.start_month)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{formatMonth(expense.end_month)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{expense.is_active ? "Yes" : "No"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="id" value={expense.id} />
                          <input type="hidden" name="is_active" value={String(expense.is_active)} />
                          <button type="submit">
                            {expense.is_active ? "Disable" : "Enable"}
                          </button>
                        </Form>

                        <Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={expense.id} />
                          <button type="submit" style={{ color: "#b42318" }}>
                            Delete
                          </button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}

                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 16, color: "#616161" }}>
                      No fixed expenses configured yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}


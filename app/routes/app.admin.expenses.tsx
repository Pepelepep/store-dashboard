import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { AppButton } from "../components/ui/AppButton";
import { FieldError } from "../components/ui/FieldError";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { StatusBadge } from "../components/ui/StatusBadge";

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

type ActionData = {
  ok: boolean;
  message?: string;
  fieldErrors?: {
    expense_name?: string;
    monthly_amount?: string;
    start_month?: string;
  };
};

const expenseCategories = [
  "Rent",
  "Payroll",
  "Utilities",
  "Insurance",
  "Software",
  "Marketing",
  "Maintenance",
  "Supplies",
  "Other",
];

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

    return { ok: true } satisfies ActionData;
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

    return { ok: true } satisfies ActionData;
  }

  const expenseName = String(formData.get("expense_name") ?? "").trim();
  const expenseCategory = String(formData.get("expense_category") ?? "").trim() || null;
  const monthlyAmount = Number(formData.get("monthly_amount") ?? 0);
  const startMonth = String(formData.get("start_month") ?? "");
  const endMonthRaw = String(formData.get("end_month") ?? "").trim();
  const endMonth = endMonthRaw || null;
  const shopifyLocationIdRaw = String(formData.get("shopify_location_id") ?? "").trim();
  const shopifyLocationId = shopifyLocationIdRaw || null;

  if (!expenseName) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: {
        expense_name: "Expense name is required.",
      },
    } satisfies ActionData;
  }
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: {
        monthly_amount: "Monthly amount must be valid.",
      },
    } satisfies ActionData;
  }
  if (!startMonth) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: {
        start_month: "Start month is required.",
      },
    } satisfies ActionData;
  }

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

  return {
    ok: true,
    message: "Expense saved.",
  } satisfies ActionData;
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
  const { locations, expenses } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const activeIntent = navigation.formData?.get("intent");
  const isSaving = isSubmitting && activeIntent === "save";
  const fieldErrors = actionData?.ok ? undefined : actionData?.fieldErrors;

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
          <h1 style={{ margin: 0, fontSize: 32 }}>Expenses</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Manage fixed expenses by location.
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
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Name
                <input
                  name="expense_name"
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: fieldErrors?.expense_name
                      ? "1px solid #d92d20"
                      : "1px solid #c9cccf",
                  }}
                />
                <HelperText>Use a clear recurring expense name.</HelperText>
                <FieldError>{fieldErrors?.expense_name}</FieldError>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Category
                <select
                  name="expense_category"
                  defaultValue=""
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #c9cccf",
                    background: "white",
                  }}
                >
                  <option value="">Select category</option>
                  {expenseCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <HelperText>Choose the closest reporting category.</HelperText>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Monthly amount
                <input
                  name="monthly_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: fieldErrors?.monthly_amount
                      ? "1px solid #d92d20"
                      : "1px solid #c9cccf",
                  }}
                />
                <HelperText>Enter the fixed monthly amount before tax if applicable.</HelperText>
                <FieldError>{fieldErrors?.monthly_amount}</FieldError>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Start month
                <input
                  name="start_month"
                  type="month"
                  required
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: fieldErrors?.start_month
                      ? "1px solid #d92d20"
                      : "1px solid #c9cccf",
                  }}
                />
                <FieldError>{fieldErrors?.start_month}</FieldError>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                End month
                <input
                  name="end_month"
                  type="month"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #c9cccf",
                  }}
                />
                <HelperText>Leave blank for ongoing expenses.</HelperText>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Location
                <select
                  name="shopify_location_id"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #c9cccf",
                    background: "white",
                  }}
                >
                  <option value="">Global / all locations</option>
                  {locations.map((location) => (
                    <option key={location.shopify_location_id} value={location.shopify_location_id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                <HelperText>Global expenses are shared across locations.</HelperText>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 16,
              }}
            >
              <AppButton type="submit" disabled={isSubmitting} variant="primary">
                {isSaving ? "Saving..." : "Save expense"}
              </AppButton>

              {actionData?.message ? (
                <InlineResult variant={actionData.ok ? "success" : "error"}>
                  {actionData.message}
                </InlineResult>
              ) : null}
            </div>
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
          <HelperText>
            Disable keeps the expense history but excludes it from future active calculations.
          </HelperText>

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
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                      <StatusBadge variant={expense.is_active ? "success" : "neutral"}>
                        {expense.is_active ? "Active" : "Inactive"}
                      </StatusBadge>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Form method="post">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="id" value={expense.id} />
                          <input type="hidden" name="is_active" value={String(expense.is_active)} />
                          <AppButton type="submit" variant="secondary" compact disabled={isSubmitting}>
                            {expense.is_active ? "Disable" : "Enable"}
                          </AppButton>
                        </Form>

                        <Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={expense.id} />
                          <AppButton type="submit" variant="danger" compact disabled={isSubmitting}>
                            Delete
                          </AppButton>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}

                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 16, color: "#616161" }}>
                      <div style={{ fontWeight: 700 }}>
                        No expenses configured yet.
                      </div>
                      <div style={{ marginTop: 4 }}>
                        Add fixed expenses to calculate location profitability.
                      </div>
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

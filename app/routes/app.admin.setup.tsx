import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { useEffect, useState } from "react";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { AppButton } from "../components/ui/AppButton";
import { FieldError } from "../components/ui/FieldError";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SectionTabs } from "../components/ui/SectionTabs";
import { ProductCostsSetup } from "../components/setup/ProductCostsSetup";
import {
  loadProductCostSetup,
  saveProductCostSettings,
  type ProductCostSetupData,
} from "../lib/financial/cogs-setup.server";
import { isValidEstimatePercent } from "../lib/financial/cogs";
import { validateExpenseMonthRange } from "../lib/financial/expense-validation";
import {
  getBillingState,
  isAccessibleBillingState,
} from "../lib/billing.server";
import { getEntitlementSnapshot } from "../lib/entitlements.server";

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
  productCosts: ProductCostSetupData;
};

type CostsTab = "products" | "expenses";

type ActionData = {
  ok: boolean;
  intent?: string;
  message?: string;
  fieldErrors?: {
    expense_name?: string;
    monthly_amount?: string;
    start_month?: string;
    end_month?: string;
    shopify_location_id?: string;
  };
};

type ExpenseFormState = {
  id: string;
  expense_name: string;
  expense_category: string;
  monthly_amount: string;
  start_month: string;
  end_month: string;
  shopify_location_id: string;
};

const emptyExpenseForm: ExpenseFormState = {
  id: "",
  expense_name: "",
  expense_category: "",
  monthly_amount: "",
  start_month: "",
  end_month: "",
  shopify_location_id: "",
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
  const url = new URL(request.url);
  if (url.pathname === "/app/admin/setup") {
    const legacyTab = url.searchParams.get("tab");
    if (
      legacyTab === "plan" ||
      legacyTab === "billing" ||
      legacyTab === "plan-and-billing"
    ) {
      url.searchParams.set("tab", "plan");
      throw redirect(`/app/settings?${url.searchParams.toString()}`);
    }
    if (
      legacyTab === "locations" ||
      legacyTab === "location-entitlement" ||
      legacyTab === "reporting-locations"
    ) {
      url.searchParams.set("tab", "reporting");
      throw redirect(`/app/locations?${url.searchParams.toString()}`);
    }
    url.searchParams.set(
      "tab",
      legacyTab === "product-costs" || legacyTab === "products"
        ? "products"
        : "expenses",
    );
    throw redirect(`/app/costs?${url.searchParams.toString()}`);
  }

  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.setup",
    shop: session.shop,
    supabase,
  });

  await assertAdminAccess({ request, session, supabase });
  const [
    { data: locationsData, error: locationsError },
    { data: expensesData, error: expensesError },
    productCosts,
  ] = await Promise.all([
    supabase
      .from("locations")
      .select("shopify_location_id, name")
      .eq("shop_domain", session.shop)
      .eq("shopify_is_active", true)
      .eq("reporting_enabled", true)
      .order("name", { ascending: true }),
    supabase
      .from("fixed_expenses")
      .select(
        "id, shop_domain, shopify_location_id, location_name, expense_name, expense_category, monthly_amount, start_month, end_month, is_active",
      )
      .eq("shop_domain", session.shop)
      .order("start_month", { ascending: false })
      .order("expense_name", { ascending: true }),
    loadProductCostSetup({
      supabase,
      shop: session.shop,
    }),
  ]);

  if (locationsError)
    throw new Response(locationsError.message, { status: 500 });
  if (expensesError) throw new Response(expensesError.message, { status: 500 });

  const locations = (locationsData ?? []) as LocationRow[];
  const expenses = (expensesData ?? []) as ExpenseRow[];
  if (locations.length === 0 && expenses.length === 0) {
    logEmptyDataState({
      route: "app.admin.setup",
      shop: session.shop,
      reason: "no_locations_or_expenses",
      counts: {
        locations: locations.length,
        expenses: expenses.length,
      },
    });
  }

  return {
    shop: session.shop,
    locations,
    expenses,
    productCosts,
  } satisfies LoaderData;
}

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;

  const currentSearch = new URLSearchParams(currentUrl.search);
  const nextSearch = new URLSearchParams(nextUrl.search);
  const tabChanged = currentSearch.get("tab") !== nextSearch.get("tab");
  currentSearch.delete("tab");
  nextSearch.delete("tab");

  if (tabChanged && currentSearch.toString() === nextSearch.toString()) {
    return false;
  }

  return defaultShouldRevalidate;
}

export async function action({ request }: ActionFunctionArgs) {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname === "/app/admin/setup") {
    const legacyTab = requestUrl.searchParams.get("tab");
    requestUrl.searchParams.set(
      "tab",
      legacyTab === "product-costs" || legacyTab === "products"
        ? "products"
        : "expenses",
    );
    throw redirect(`/app/costs?${requestUrl.searchParams.toString()}`);
  }

  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.setup.action",
    shop: session.shop,
    supabase,
  });

  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  const currentBilling = await getBillingState({ admin, shop: session.shop });
  if (isAccessibleBillingState(currentBilling)) {
    const currentEntitlements = await getEntitlementSnapshot({
      supabase,
      shop: session.shop,
      billing: currentBilling,
    });
    if (currentEntitlements.resolutionRequired) {
      const url = new URL(request.url);
      url.searchParams.set("tab", "plan");
      url.searchParams.set("resolution", "required");
      throw redirect(`/app/settings?${url.searchParams.toString()}`);
    }
  }

  if (intent === "save-product-costs") {
    const enabled =
      String(formData.get("estimate_enabled") ?? "false") === "true";
    const estimateCustomSales =
      String(formData.get("estimate_custom_sales") ?? "false") === "true";
    const rawPercent = String(formData.get("estimate_percent") ?? "").trim();
    const percent = rawPercent === "" ? null : Number(rawPercent);

    if (enabled && (percent === null || !isValidEstimatePercent(percent))) {
      return {
        ok: false,
        intent,
        message: "Enter an estimated cost rate from 0% to 100%.",
      } satisfies ActionData;
    }

    const recalculatedCount = await saveProductCostSettings({
      supabase,
      shop: session.shop,
      enabled,
      percent: enabled ? percent : null,
      estimateCustomSales,
    });

    return {
      ok: true,
      intent,
      message: `Product cost settings saved. ${recalculatedCount} sales lines recalculated.`,
    } satisfies ActionData;
  }

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) throw new Response("Missing expense id", { status: 400 });

    const { error } = await supabase
      .from("fixed_expenses")
      .delete()
      .eq("shop_domain", session.shop)
      .eq("id", id);

    if (error) throw new Response(error.message, { status: 500 });

    return { ok: true, intent } satisfies ActionData;
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

    return { ok: true, intent } satisfies ActionData;
  }

  const expenseName = String(formData.get("expense_name") ?? "").trim();
  const expenseCategory =
    String(formData.get("expense_category") ?? "").trim() || null;
  const monthlyAmount = Number(formData.get("monthly_amount") ?? 0);
  const startMonth = String(formData.get("start_month") ?? "");
  const endMonthRaw = String(formData.get("end_month") ?? "").trim();
  const endMonth = endMonthRaw || null;
  const shopifyLocationIdRaw = String(
    formData.get("shopify_location_id") ?? "",
  ).trim();
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
  const monthFieldErrors = validateExpenseMonthRange({
    startMonth,
    endMonth,
  });
  if (Object.keys(monthFieldErrors).length > 0) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: monthFieldErrors,
    } satisfies ActionData;
  }

  let locationName: string | null = null;

  if (shopifyLocationId) {
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("name")
      .eq("shop_domain", session.shop)
      .eq("shopify_location_id", shopifyLocationId)
      .eq("shopify_is_active", true)
      .eq("reporting_enabled", true)
      .maybeSingle();

    if (locationError)
      throw new Response(locationError.message, { status: 500 });
    if (!location) {
      return {
        ok: false,
        message: "Please fix the highlighted fields.",
        fieldErrors: {
          shopify_location_id:
            "Select a location that belongs to this Shopify store.",
        },
      } satisfies ActionData;
    }
    locationName = location.name;
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
    intent,
    message: "Expense saved.",
  } satisfies ActionData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
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

export default function AdminSetupPage() {
  const { shop, locations, expenses, productCosts } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const navigation = useNavigation();
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const tab: CostsTab = requestedTab === "expenses" ? "expenses" : "products";
  const [formState, setFormState] =
    useState<ExpenseFormState>(emptyExpenseForm);
  const [isActionFeedbackHidden, setIsActionFeedbackHidden] = useState(false);
  const isSubmitting = navigation.state !== "idle";
  const activeIntent = navigation.formData?.get("intent");
  const isSaving = isSubmitting && activeIntent === "save";
  const visibleActionData = isActionFeedbackHidden ? undefined : actionData;
  const fieldErrors = visibleActionData?.ok
    ? undefined
    : visibleActionData?.fieldErrors;
  const isEditing = Boolean(formState.id);

  useEffect(() => {
    setIsActionFeedbackHidden(false);
  }, [actionData]);

  function clearActionFeedback() {
    setIsActionFeedbackHidden(true);
  }

  function updateFormField(field: keyof ExpenseFormState, value: string) {
    clearActionFeedback();
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    clearActionFeedback();
    setFormState(emptyExpenseForm);
  }

  function editExpense(expense: ExpenseRow) {
    clearActionFeedback();
    setFormState({
      id: expense.id,
      expense_name: expense.expense_name,
      expense_category: expense.expense_category ?? "",
      monthly_amount: String(expense.monthly_amount ?? ""),
      start_month: formatMonth(expense.start_month),
      end_month: expense.end_month ? formatMonth(expense.end_month) : "",
      shopify_location_id: expense.shopify_location_id ?? "",
    });
  }

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
          <h1 style={{ margin: 0, fontSize: 32 }}>Costs</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Manage product costs and recurring operating expenses.
          </p>
        </header>
        <SectionTabs
          activeTab={tab}
          ariaLabel="Costs sections"
          tabs={[
            { value: "products", label: "Product costs" },
            { value: "expenses", label: "Operating expenses" },
          ]}
        />

        {tab === "products" ? (
          <ProductCostsSetup
            actionData={actionData}
            data={productCosts}
            shop={shop}
          />
        ) : (
          <>
            <section
              style={{
                background: "white",
                border: "1px solid #e3e3e3",
                borderRadius: 16,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <h2 style={{ marginTop: 0 }}>
                {isEditing ? "Edit expense" : "Add expense"}
              </h2>

              <Form method="post">
                <input type="hidden" name="intent" value="save" />
                {formState.id ? (
                  <input type="hidden" name="id" value={formState.id} />
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                      alignItems: "start",
                    }}
                  >
                    <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                      Name
                      <input
                        name="expense_name"
                        required
                        value={formState.expense_name}
                        onChange={(event) =>
                          updateFormField("expense_name", event.target.value)
                        }
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
                      <HelperText>
                        Use a clear recurring expense name.
                      </HelperText>
                      <FieldError>{fieldErrors?.expense_name}</FieldError>
                    </label>

                    <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                      Category
                      <select
                        name="expense_category"
                        value={formState.expense_category}
                        onChange={(event) =>
                          updateFormField(
                            "expense_category",
                            event.target.value,
                          )
                        }
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
                      <HelperText>
                        Choose the closest reporting category.
                      </HelperText>
                    </label>

                    <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                      Monthly amount
                      <input
                        name="monthly_amount"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={formState.monthly_amount}
                        onChange={(event) =>
                          updateFormField("monthly_amount", event.target.value)
                        }
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
                      <HelperText>
                        Enter the fixed monthly amount before tax if applicable.
                      </HelperText>
                      <FieldError>{fieldErrors?.monthly_amount}</FieldError>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 14,
                      alignItems: "start",
                    }}
                  >
                    <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                      Start month
                      <input
                        name="start_month"
                        type="month"
                        required
                        value={formState.start_month}
                        onChange={(event) =>
                          updateFormField("start_month", event.target.value)
                        }
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
                        value={formState.end_month}
                        onChange={(event) =>
                          updateFormField("end_month", event.target.value)
                        }
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: 10,
                          borderRadius: 8,
                          border: fieldErrors?.end_month
                            ? "1px solid #d92d20"
                            : "1px solid #c9cccf",
                        }}
                      />
                      <HelperText>Leave blank for ongoing expenses.</HelperText>
                      <FieldError>{fieldErrors?.end_month}</FieldError>
                    </label>

                    <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                      Location
                      <select
                        name="shopify_location_id"
                        value={formState.shopify_location_id}
                        onChange={(event) =>
                          updateFormField(
                            "shopify_location_id",
                            event.target.value,
                          )
                        }
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          padding: 10,
                          borderRadius: 8,
                          border: fieldErrors?.shopify_location_id
                            ? "1px solid #d92d20"
                            : "1px solid #c9cccf",
                          background: "white",
                        }}
                      >
                        <option value="">Global / all locations</option>
                        {locations.map((location) => (
                          <option
                            key={location.shopify_location_id}
                            value={location.shopify_location_id}
                          >
                            {location.name}
                          </option>
                        ))}
                      </select>
                      <HelperText>
                        Global expenses are shared equally across all active
                        locations.
                      </HelperText>
                      <FieldError>
                        {fieldErrors?.shopify_location_id}
                      </FieldError>
                    </label>
                  </div>
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
                  <AppButton
                    type="submit"
                    disabled={isSubmitting}
                    variant="primary"
                  >
                    {isSaving
                      ? isEditing
                        ? "Updating..."
                        : "Saving..."
                      : isEditing
                        ? "Update expense"
                        : "Save expense"}
                  </AppButton>

                  {isEditing ? (
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={isSubmitting}
                      onClick={resetForm}
                    >
                      Cancel edit
                    </AppButton>
                  ) : (
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={isSubmitting}
                      onClick={resetForm}
                    >
                      New expense
                    </AppButton>
                  )}

                  {visibleActionData?.message ? (
                    <InlineResult
                      variant={visibleActionData.ok ? "success" : "error"}
                    >
                      {visibleActionData.message}
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
                Disable keeps the expense history but excludes it from future
                active calculations.
              </HelperText>

              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr>
                      {[
                        "Name",
                        "Category",
                        "Location",
                        "Monthly amount",
                        "Start",
                        "End",
                        "Active",
                        "Actions",
                      ].map((header) => (
                        <th
                          key={header}
                          style={{
                            textAlign:
                              header === "Monthly amount" ? "right" : "left",
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
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {expense.expense_name}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {expense.expense_category ?? "-"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {expense.location_name ?? "Global"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                            textAlign: "right",
                          }}
                        >
                          {formatCurrency(Number(expense.monthly_amount ?? 0))}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {formatMonth(expense.start_month)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          {formatMonth(expense.end_month)}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          <StatusBadge
                            variant={expense.is_active ? "success" : "neutral"}
                          >
                            {expense.is_active ? "Active" : "Inactive"}
                          </StatusBadge>
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #eee",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8 }}>
                            <AppButton
                              type="button"
                              variant="secondary"
                              compact
                              disabled={isSubmitting}
                              onClick={() => editExpense(expense)}
                            >
                              Edit
                            </AppButton>

                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="toggle"
                              />
                              <input
                                type="hidden"
                                name="id"
                                value={expense.id}
                              />
                              <input
                                type="hidden"
                                name="is_active"
                                value={String(expense.is_active)}
                              />
                              <AppButton
                                type="submit"
                                variant="secondary"
                                compact
                                disabled={isSubmitting}
                              >
                                {expense.is_active ? "Disable" : "Enable"}
                              </AppButton>
                            </Form>

                            <Form
                              method="post"
                              onSubmit={(event) => {
                                if (
                                  !window.confirm(
                                    `Delete “${expense.expense_name}”? Reporting will update to remove this expense. This cannot be undone.`,
                                  )
                                ) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input
                                type="hidden"
                                name="intent"
                                value="delete"
                              />
                              <input
                                type="hidden"
                                name="id"
                                value={expense.id}
                              />
                              <AppButton
                                type="submit"
                                variant="danger"
                                compact
                                disabled={isSubmitting}
                              >
                                Delete
                              </AppButton>
                            </Form>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {expenses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          style={{ padding: 16, color: "#616161" }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            No expenses configured yet.
                          </div>
                          <div style={{ marginTop: 4 }}>
                            Add fixed expenses to calculate location
                            profitability.
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

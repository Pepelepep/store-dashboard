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
import { CalculatorIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertCapabilityAccess } from "../lib/auth/permissions.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { getShopLevelAdminClient } from "../lib/shopify/shop-level-admin.server";
import { AppButton } from "../components/ui/AppButton";
import { FieldError } from "../components/ui/FieldError";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SectionTabs } from "../components/ui/SectionTabs";
import {
  ContentCard,
  EmptyState,
  FormActions,
  PageHeader,
  ShopOpsPage,
  SummaryCard,
} from "../components/ui/ShopOpsPage";
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

  await assertCapabilityAccess({
    capability: "manage_costs",
    request,
    route: "app.admin.setup",
    session,
    supabase,
  });
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

  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.setup.action",
    shop: session.shop,
    supabase,
  });

  await assertCapabilityAccess({
    capability: "manage_costs",
    request,
    route: "app.admin.setup.action",
    session,
    supabase,
  });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  const billingAdmin = await getShopLevelAdminClient({
    shop: session.shop,
    route: "costs.action",
  });
  const currentBilling = await getBillingState({
    admin: billingAdmin,
    shop: session.shop,
  });
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
  const activeExpenses = expenses.filter((expense) => expense.is_active);
  const configuredMonthlyExpenses = activeExpenses.reduce(
    (total, expense) => total + Number(expense.monthly_amount ?? 0),
    0,
  );

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
    <ShopOpsPage>
      <PageHeader
        description="Manage the inputs used to calculate product and operating profit."
        icon={CalculatorIcon}
        title="Costs"
      />
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
          <div className="shopops-summary-grid">
            <SummaryCard
              label="Configured monthly amount"
              value={formatCurrency(configuredMonthlyExpenses)}
              detail="Across active expense rules"
            />
            <SummaryCard
              label="Active expense rules"
              value={activeExpenses.length}
              detail={`${expenses.length - activeExpenses.length} inactive`}
            />
          </div>
          <ContentCard title={isEditing ? "Edit expense" : "Add expense"}>
            <Form method="post">
              <input type="hidden" name="intent" value="save" />
              {formState.id ? (
                <input type="hidden" name="id" value={formState.id} />
              ) : null}

              <div className="shopops-form-stack">
                <div className="shopops-form-grid">
                  <label className="shopops-form-field">
                    Name
                    <input
                      name="expense_name"
                      required
                      value={formState.expense_name}
                      onChange={(event) =>
                        updateFormField("expense_name", event.target.value)
                      }
                      className="shopops-form-control"
                      data-invalid={Boolean(fieldErrors?.expense_name)}
                    />
                    <HelperText>Use a clear recurring expense name.</HelperText>
                    <FieldError>{fieldErrors?.expense_name}</FieldError>
                  </label>

                  <label className="shopops-form-field">
                    Category
                    <select
                      name="expense_category"
                      value={formState.expense_category}
                      onChange={(event) =>
                        updateFormField("expense_category", event.target.value)
                      }
                      className="shopops-form-control"
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

                  <label className="shopops-form-field">
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
                      className="shopops-form-control"
                      data-invalid={Boolean(fieldErrors?.monthly_amount)}
                    />
                    <HelperText>
                      Enter the fixed monthly amount before tax if applicable.
                    </HelperText>
                    <FieldError>{fieldErrors?.monthly_amount}</FieldError>
                  </label>
                </div>

                <div className="shopops-form-grid">
                  <label className="shopops-form-field">
                    Start month
                    <input
                      name="start_month"
                      type="month"
                      required
                      value={formState.start_month}
                      onChange={(event) =>
                        updateFormField("start_month", event.target.value)
                      }
                      className="shopops-form-control"
                      data-invalid={Boolean(fieldErrors?.start_month)}
                    />
                    <FieldError>{fieldErrors?.start_month}</FieldError>
                  </label>

                  <label className="shopops-form-field">
                    End month
                    <input
                      name="end_month"
                      type="month"
                      value={formState.end_month}
                      onChange={(event) =>
                        updateFormField("end_month", event.target.value)
                      }
                      className="shopops-form-control"
                      data-invalid={Boolean(fieldErrors?.end_month)}
                    />
                    <HelperText>Leave blank for ongoing expenses.</HelperText>
                    <FieldError>{fieldErrors?.end_month}</FieldError>
                  </label>

                  <label className="shopops-form-field">
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
                      className="shopops-form-control"
                      data-invalid={Boolean(fieldErrors?.shopify_location_id)}
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
                    <FieldError>{fieldErrors?.shopify_location_id}</FieldError>
                  </label>
                </div>
              </div>

              <FormActions
                feedback={
                  visibleActionData?.message ? (
                    <InlineResult
                      variant={visibleActionData.ok ? "success" : "error"}
                    >
                      {visibleActionData.message}
                    </InlineResult>
                  ) : undefined
                }
              >
                <AppButton
                  type="submit"
                  disabled={isSubmitting}
                  variant="primary"
                  fullWidth
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
                    fullWidth
                  >
                    Cancel edit
                  </AppButton>
                ) : (
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={resetForm}
                    fullWidth
                  >
                    New expense
                  </AppButton>
                )}
              </FormActions>
            </Form>
          </ContentCard>

          <ContentCard
            title="Current expenses"
            description="Disable keeps the expense history but excludes it from future active calculations."
          >
            <div className="shopops-data-table-scroll">
              <table className="shopops-data-table">
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
                        data-align={
                          header === "Monthly amount" ? "right" : undefined
                        }
                        key={header}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>{expense.expense_name}</td>
                      <td>{expense.expense_category ?? "-"}</td>
                      <td>{expense.location_name ?? "Global"}</td>
                      <td data-align="right">
                        {formatCurrency(Number(expense.monthly_amount ?? 0))}
                      </td>
                      <td>{formatMonth(expense.start_month)}</td>
                      <td>{formatMonth(expense.end_month)}</td>
                      <td>
                        <StatusBadge
                          variant={expense.is_active ? "success" : "neutral"}
                        >
                          {expense.is_active ? "Active" : "Inactive"}
                        </StatusBadge>
                      </td>
                      <td>
                        <div className="shopops-table-actions">
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
                            <input type="hidden" name="intent" value="toggle" />
                            <input type="hidden" name="id" value={expense.id} />
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
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={expense.id} />
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
                      <td className="shopops-data-table__empty" colSpan={8}>
                        <EmptyState
                          title="No expenses configured yet."
                          description="Add fixed expenses to calculate location profitability."
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </ContentCard>
        </>
      )}
    </ShopOpsPage>
  );
}

import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigate } from "react-router";

import { authenticate } from "../shopify.server";

type LocationNode = {
  id: string;
  name: string;
  isActive: boolean;
};

type OrderLineItemNode = {
  id: string;
  title: string;
  quantity: number;
  sku?: string | null;
  variant?: {
    id: string;
    title?: string | null;
    sku?: string | null;
    inventoryItem?: {
      id: string;
      unitCost?: {
        amount: string;
        currencyCode: string;
      } | null;
    } | null;
    product?: {
      id: string;
      title: string;
      vendor?: string | null;
    } | null;
  } | null;
  discountedUnitPriceSet?: {
    shopMoney?: {
      amount: string;
      currencyCode: string;
    } | null;
  } | null;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  retailLocation?: {
    id: string;
    name: string;
  } | null;
  lineItems: {
    edges: {
      node: OrderLineItemNode;
    }[];
  };
};

type StaffOrderNode = OrderNode & {
  staffMember?: {
    id: string;
    name: string;
  } | null;
};

type InventoryLevelNode = {
  location: {
    id: string;
    name: string;
  };
  quantities: {
    name: string;
    quantity: number;
  }[];
};

type VariantNode = {
  id: string;
  title: string;
  sku?: string | null;
  inventoryItem?: {
    id: string;
    sku?: string | null;
    tracked: boolean;
    unitCost?: {
      amount: string;
      currencyCode: string;
    } | null;
    inventoryLevels: {
      edges: {
        node: InventoryLevelNode;
      }[];
    };
  } | null;
};

type ProductNode = {
  id: string;
  title: string;
  vendor?: string | null;
  variants: {
    edges: {
      node: VariantNode;
    }[];
  };
};

type OrderLineRow = {
  orderId: string;
  orderName: string;
  createdAt: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  vendor: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  locationId: string;
  locationName: string;
  staffName: string;
  orderUrl: string;
};

type InventoryRow = {
  productTitle: string;
  variantTitle: string;
  sku: string;
  vendor: string;
  locationId: string;
  locationName: string;
  available: number;
  tracked: boolean;
  unitCost: number;
};

type TopProductRow = {
  productTitle: string;
  sku: string;
  vendor: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  revenueSharePct: number;
};

type StockAlertRow = {
  productTitle: string;
  variantTitle: string;
  sku: string;
  vendor: string;
  available: number;
  unitsSold: number;
  avgDailySales: number;
  daysOfStock: number | null;
  status: "Critical" | "Warning" | "Healthy" | "No sales";
};

type VendorSummaryRow = {
  vendor: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  unitsSold: number;
  inventoryUnits: number;
  lowStockSkus: number;
};

type StaffSummaryRow = {
  staffName: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
};

type FixedExpenseRow = {
  id: string;
  name: string;
  monthlyAmount: number;
  locationId: string | null;
  locationName: string;
  category: string;
};

type LoaderData = {
  locations: LocationNode[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
  selectedDays: number;
  kpis: {
    revenue: number;
    ordersCount: number;
    unitsSold: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
    expensesToDate: number | null;
    netProfit: number | null;
    criticalStockCount: number;
  };
  topProducts: TopProductRow[];
  stockAlerts: StockAlertRow[];
  vendorSummary: VendorSummaryRow[];
  staffSummary: StaffSummaryRow[];
  expenseRows: FixedExpenseRow[];
  recentOrders: OrderLineRow[];
  notices: string[];
  errors?: unknown[];
};

const fixedExpenses: FixedExpenseRow[] = [
  {
    id: "rent-downtown",
    name: "Rent / fixed cost",
    monthlyAmount: 0,
    locationId: null,
    locationName: "All locations",
    category: "Fixed cost",
  },
  {
    id: "staff-general",
    name: "Staff",
    monthlyAmount: 0,
    locationId: null,
    locationName: "All locations",
    category: "Payroll",
  },
  {
    id: "shopify-billing",
    name: "Shopify billing",
    monthlyAmount: 0,
    locationId: null,
    locationName: "All locations",
    category: "Software",
  },
  {
    id: "marketing",
    name: "Marketing",
    monthlyAmount: 0,
    locationId: null,
    locationName: "All locations",
    category: "Marketing",
  },
];

function getTodayLocalDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toShopifyDateTimeLocal(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}${sign}${hours}:${minutes}`;
}

function getDateRange(startDateParam: string | null, endDateParam: string | null) {
  const today = getTodayLocalDate();
  const startDate = startDateParam || today;
  const endDate = endDateParam || today;

  const start = parseLocalDate(startDate);
  const inclusiveEnd = parseLocalDate(endDate);
  const exclusiveEnd = addDays(inclusiveEnd, 1);

  const selectedDays = Math.max(
    1,
    Math.ceil((exclusiveEnd.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return {
    startDate,
    endDate,
    startDateTime: toShopifyDateTimeLocal(start),
    endDateTime: toShopifyDateTimeLocal(exclusiveEnd),
    selectedDays,
    isToday: startDate === today && endDate === today,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-CA").format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function getAvailableQuantity(level: InventoryLevelNode) {
  return (
    level.quantities.find((quantity) => quantity.name === "available")
      ?.quantity ?? 0
  );
}

function getNumericCost(value?: string | null) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function computeTopProducts(orderRows: OrderLineRow[]): TopProductRow[] {
  const totalRevenue = orderRows.reduce((sum, row) => sum + row.revenue, 0);
  const grouped = new Map<string, Omit<TopProductRow, "revenueSharePct">>();

  for (const row of orderRows) {
    const key = `${row.productTitle}__${row.sku}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.unitsSold += row.quantity;
      existing.revenue += row.revenue;
      existing.cogs += row.cogs;
      existing.grossProfit += row.grossProfit;
    } else {
      grouped.set(key, {
        productTitle: row.productTitle,
        sku: row.sku,
        vendor: row.vendor,
        unitsSold: row.quantity,
        revenue: row.revenue,
        cogs: row.cogs,
        grossProfit: row.grossProfit,
      });
    }
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      revenueSharePct: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeStockAlerts(
  inventoryRows: InventoryRow[],
  orderRows: OrderLineRow[],
  periodDays: number,
): StockAlertRow[] {
  const soldBySku = new Map<string, number>();

  for (const row of orderRows) {
    const key = row.sku || row.productTitle;
    soldBySku.set(key, (soldBySku.get(key) ?? 0) + row.quantity);
  }

  return inventoryRows
    .map((inventory) => {
      const key = inventory.sku || inventory.productTitle;
      const unitsSold = soldBySku.get(key) ?? 0;
      const avgDailySales = periodDays > 0 ? unitsSold / periodDays : 0;
      const daysOfStock =
        avgDailySales > 0 ? inventory.available / avgDailySales : null;

      let status: StockAlertRow["status"] = "Healthy";

      if (avgDailySales === 0) {
        status = "No sales";
      } else if (daysOfStock !== null && daysOfStock <= 3) {
        status = "Critical";
      } else if (daysOfStock !== null && daysOfStock <= 7) {
        status = "Warning";
      }

      return {
        productTitle: inventory.productTitle,
        variantTitle: inventory.variantTitle,
        sku: inventory.sku,
        vendor: inventory.vendor,
        available: inventory.available,
        unitsSold,
        avgDailySales,
        daysOfStock,
        status,
      };
    })
    .filter((row) => row.status === "Critical" || row.status === "Warning")
    .sort((a, b) => {
      const aDays = a.daysOfStock ?? 999999;
      const bDays = b.daysOfStock ?? 999999;
      return aDays - bDays;
    })
    .slice(0, 15);
}

function computeVendorSummary(
  orderRows: OrderLineRow[],
  inventoryRows: InventoryRow[],
): VendorSummaryRow[] {
  const vendors = new Map<string, VendorSummaryRow>();

  for (const row of orderRows) {
    const vendor = row.vendor || "-";
    const existing =
      vendors.get(vendor) ??
      ({
        vendor,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
        unitsSold: 0,
        inventoryUnits: 0,
        lowStockSkus: 0,
      } satisfies VendorSummaryRow);

    existing.revenue += row.revenue;
    existing.cogs += row.cogs;
    existing.grossProfit += row.grossProfit;
    existing.unitsSold += row.quantity;
    vendors.set(vendor, existing);
  }

  for (const row of inventoryRows) {
    const vendor = row.vendor || "-";
    const existing =
      vendors.get(vendor) ??
      ({
        vendor,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
        unitsSold: 0,
        inventoryUnits: 0,
        lowStockSkus: 0,
      } satisfies VendorSummaryRow);

    existing.inventoryUnits += row.available;

    if (row.tracked && row.available <= 5) {
      existing.lowStockSkus += 1;
    }

    vendors.set(vendor, existing);
  }

  return Array.from(vendors.values())
    .map((row) => ({
      ...row,
      grossMarginPct: row.revenue > 0 ? (row.grossProfit / row.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeStaffSummary(orderRows: OrderLineRow[]): StaffSummaryRow[] {
  const staff = new Map<string, StaffSummaryRow>();

  for (const row of orderRows) {
    const staffName = row.staffName || "Unassigned / unavailable";
    const existing =
      staff.get(staffName) ??
      ({
        staffName,
        revenue: 0,
        ordersCount: 0,
        unitsSold: 0,
      } satisfies StaffSummaryRow);

    existing.revenue += row.revenue;
    existing.unitsSold += row.quantity;
    staff.set(staffName, existing);
  }

  for (const row of staff.values()) {
    const uniqueOrders = new Set(
      orderRows
        .filter((orderRow) => orderRow.staffName === row.staffName)
        .map((orderRow) => orderRow.orderId),
    );
    row.ordersCount = uniqueOrders.size;
  }

  return Array.from(staff.values()).sort((a, b) => b.revenue - a.revenue);
}

function getExpenseRowsForLocation(
  expenses: FixedExpenseRow[],
  selectedLocationId: string,
) {
  return expenses.filter(
    (expense) => expense.locationId === null || expense.locationId === selectedLocationId,
  );
}

function computeExpensesToDate(expenses: FixedExpenseRow[], selectedDays: number) {
  const monthlyTotal = expenses.reduce((sum, expense) => sum + expense.monthlyAmount, 0);
  return (monthlyTotal / 30) * selectedDays;
}

function buildCostMaps(products: ProductNode[]) {
  const costByVariantId = new Map<string, number>();
  const costBySku = new Map<string, number>();

  for (const product of products) {
    for (const { node: variant } of product.variants.edges) {
      const unitCost = getNumericCost(variant.inventoryItem?.unitCost?.amount);
      costByVariantId.set(variant.id, unitCost);

      if (variant.sku) {
        costBySku.set(variant.sku, unitCost);
      }

      if (variant.inventoryItem?.sku) {
        costBySku.set(variant.inventoryItem.sku, unitCost);
      }
    }
  }

  return { costByVariantId, costBySku };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const requestedLocationId = url.searchParams.get("locationId");
  const dateRange = getDateRange(
    url.searchParams.get("startDate"),
    url.searchParams.get("endDate"),
  );

  const locationsResponse = await admin.graphql(`#graphql
    query getLocations {
      locations(first: 50) {
        edges {
          node {
            id
            name
            isActive
          }
        }
      }
    }
  `);

  const locationsData = await locationsResponse.json();

  const locations: LocationNode[] =
    locationsData.data?.locations?.edges?.map(
      (edge: { node: LocationNode }) => edge.node,
    ) ?? [];

  const activeLocations = locations.filter((location) => location.isActive);

  const selectedLocation =
    activeLocations.find((location) => location.id === requestedLocationId) ??
    activeLocations[0] ??
    null;

  const selectedLocationId = selectedLocation?.id ?? null;
  const selectedLocationName = selectedLocation?.name ?? null;
  const shopHandle = session.shop.replace(".myshopify.com", "");

  if (!selectedLocationId) {
    return {
      locations: activeLocations,
      selectedLocationId: null,
      selectedLocationName: null,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      selectedDays: dateRange.selectedDays,
      kpis: {
        revenue: 0,
        ordersCount: 0,
        unitsSold: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
        expensesToDate: null,
        netProfit: null,
        criticalStockCount: 0,
      },
      topProducts: [],
      stockAlerts: [],
      vendorSummary: [],
      staffSummary: [],
      expenseRows: [],
      recentOrders: [],
      notices: ["No active Shopify location found."],
      errors: locationsData.errors ? [locationsData.errors] : undefined,
    } satisfies LoaderData;
  }

  const orderQuery = `created_at:>=${dateRange.startDateTime} created_at:<${dateRange.endDateTime}`;

  const [ordersResponse, inventoryResponse] = await Promise.all([
    admin.graphql(
      `#graphql
        query getRecentOrdersForDashboard($query: String!) {
          orders(first: 75, sortKey: CREATED_AT, reverse: true, query: $query) {
            edges {
              node {
                id
                name
                createdAt
                retailLocation {
                  id
                  name
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      title
                      quantity
                      sku
                      variant {
                        id
                        title
                        sku
                        inventoryItem {
                          id
                          unitCost {
                            amount
                            currencyCode
                          }
                        }
                        product {
                          id
                          title
                          vendor
                        }
                      }
                      discountedUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: orderQuery,
        },
      },
    ),
    admin.graphql(`#graphql
      query getInventoryForDashboard {
        products(first: 20) {
          edges {
            node {
              id
              title
              vendor
              variants(first: 30) {
                edges {
                  node {
                    id
                    title
                    sku
                    inventoryItem {
                      id
                      sku
                      tracked
                      unitCost {
                        amount
                        currencyCode
                      }
                      inventoryLevels(first: 10) {
                        edges {
                          node {
                            location {
                              id
                              name
                            }
                            quantities(names: ["available"]) {
                              name
                              quantity
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `),
  ]);

  const ordersData = await ordersResponse.json();
  const inventoryData = await inventoryResponse.json();

  const orders: OrderNode[] =
    ordersData.data?.orders?.edges?.map(
      (edge: { node: OrderNode }) => edge.node,
    ) ?? [];

  const products: ProductNode[] =
    inventoryData.data?.products?.edges?.map(
      (edge: { node: ProductNode }) => edge.node,
    ) ?? [];

  const { costByVariantId, costBySku } = buildCostMaps(products);

  let staffRowsByOrderId = new Map<string, string>();
  let staffNotice: string | null = null;

  try {
    const staffResponse = await admin.graphql(
      `#graphql
        query getOrdersStaffForDashboard($query: String!) {
          orders(first: 75, sortKey: CREATED_AT, reverse: true, query: $query) {
            edges {
              node {
                id
                retailLocation {
                  id
                }
                staffMember {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: orderQuery,
        },
      },
    );

    const staffData = await staffResponse.json();
    const staffOrders: StaffOrderNode[] =
      staffData.data?.orders?.edges?.map(
        (edge: { node: StaffOrderNode }) => edge.node,
      ) ?? [];

    staffRowsByOrderId = new Map(
      staffOrders
        .filter((order) => order.retailLocation?.id === selectedLocationId)
        .map((order) => [
          order.id,
          order.staffMember?.name ?? "Unassigned / unavailable",
        ]),
    );
  } catch {
    staffNotice =
      "Sales by staff is unavailable with the current Shopify permissions or plan. It usually requires staff/user access to be enabled.";
  }

  const orderRows: OrderLineRow[] = orders.flatMap((order) => {
    if (order.retailLocation?.id !== selectedLocationId) {
      return [];
    }

    return order.lineItems.edges.map(({ node: lineItem }) => {
      const unitPrice = Number(
        lineItem.discountedUnitPriceSet?.shopMoney?.amount ?? 0,
      );
      const variantId = lineItem.variant?.id ?? "-";
      const sku = lineItem.sku ?? lineItem.variant?.sku ?? "-";
      const lineItemUnitCost = getNumericCost(
        lineItem.variant?.inventoryItem?.unitCost?.amount,
      );
      const unitCost =
        lineItemUnitCost || costByVariantId.get(variantId) || costBySku.get(sku) || 0;
      const revenue = unitPrice * lineItem.quantity;
      const cogs = unitCost * lineItem.quantity;
      const grossProfit = revenue - cogs;

      return {
        orderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
        productTitle: lineItem.variant?.product?.title ?? lineItem.title,
        variantTitle: lineItem.variant?.title ?? "-",
        sku,
        vendor: lineItem.variant?.product?.vendor ?? "-",
        quantity: lineItem.quantity,
        unitPrice,
        unitCost,
        revenue,
        cogs,
        grossProfit,
        locationId: order.retailLocation?.id ?? "-",
        locationName: order.retailLocation?.name ?? "-",
        staffName: staffRowsByOrderId.get(order.id) ?? "Unassigned / unavailable",
        orderUrl: `https://admin.shopify.com/store/${shopHandle}/orders/${order.id.split("/").pop() ?? ""}`,
      };
    });
  });

  const inventoryRows: InventoryRow[] = products.flatMap((product) =>
    product.variants.edges.flatMap(({ node: variant }) => {
      const inventoryItem = variant.inventoryItem;

      if (!inventoryItem) {
        return [];
      }

      const unitCost = getNumericCost(inventoryItem.unitCost?.amount);

      return inventoryItem.inventoryLevels.edges.flatMap(({ node: level }) => {
        if (level.location.id !== selectedLocationId) {
          return [];
        }

        return [
          {
            productTitle: product.title,
            variantTitle: variant.title,
            sku: variant.sku ?? inventoryItem.sku ?? "-",
            vendor: product.vendor ?? "-",
            locationId: level.location.id,
            locationName: level.location.name,
            available: getAvailableQuantity(level),
            tracked: inventoryItem.tracked,
            unitCost,
          },
        ];
      });
    }),
  );

  const expenseRows: FixedExpenseRow[] = [];
  const expensesToDate: number | null = null;

  const revenue = orderRows.reduce((sum, row) => sum + row.revenue, 0);
  const cogs = orderRows.reduce((sum, row) => sum + row.cogs, 0);
  const grossProfit = revenue - cogs;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netProfit: number | null = null;
  const unitsSold = orderRows.reduce((sum, row) => sum + row.quantity, 0);
  const uniqueOrders = new Set(orderRows.map((row) => row.orderId));
  const ordersCount = uniqueOrders.size;

  const stockAlerts = computeStockAlerts(
    inventoryRows,
    orderRows,
    dateRange.selectedDays,
  );

  const criticalStockCount = stockAlerts.filter(
    (row) => row.status === "Critical",
  ).length;

  const errors = [locationsData.errors, ordersData.errors, inventoryData.errors]
    .filter(Boolean)
    .flat();

  const notices: string[] = [];

  return {
    locations: activeLocations,
    selectedLocationId,
    selectedLocationName,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    selectedDays: dateRange.selectedDays,
    kpis: {
      revenue,
      ordersCount,
      unitsSold,
      cogs,
      grossProfit,
      grossMarginPct,
      expensesToDate,
      netProfit,
      criticalStockCount,
    },
    topProducts: computeTopProducts(orderRows),
    stockAlerts,
    vendorSummary: computeVendorSummary(orderRows, inventoryRows),
    staffSummary: computeStaffSummary(orderRows),
    expenseRows,
    recentOrders: orderRows.slice(0, 25),
    notices,
    errors: errors.length > 0 ? errors : undefined,
  } satisfies LoaderData;
}

function escapeCsvValue(value: unknown) {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const csvContent = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function ExportButton({
  label = "CSV",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "1px solid #d1d5db",
        background: "#ffffff",
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        color: "#202223",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  exportValue,
  selectedLocationName,
  startDate,
  endDate,
}: {
  title: string;
  value: string;
  subtitle: string;
  exportValue: string | number;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
        minHeight: 132,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div style={{ color: "#5f6368", fontSize: 14, fontWeight: 700 }}>
          {title}
        </div>

        <ExportButton
          onClick={() =>
            downloadCsv(
              `${title.toLowerCase().replaceAll(" ", "-")}.csv`,
              ["Metric", "Value", "Location", "Start date", "End date"],
              [[title, exportValue, selectedLocationName ?? "-", startDate, endDate]],
            )
          }
        />
      </div>

      <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 8 }}>
        {value}
      </div>

      <div style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.35 }}>
        {subtitle}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  exportConfig,
  helperText,
}: {
  title: string;
  children: React.ReactNode;
  helperText?: string;
  exportConfig?: {
    filename: string;
    headers: string[];
    rows: Array<Array<unknown>>;
  };
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 22,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        minHeight: 392,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: helperText ? 8 : 16,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          {helperText ? (
            <p
              style={{
                margin: "8px 0 0",
                color: "#6b7280",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {helperText}
            </p>
          ) : null}
        </div>

        {exportConfig ? (
          <ExportButton
            onClick={() =>
              downloadCsv(
                exportConfig.filename,
                exportConfig.headers,
                exportConfig.rows,
              )
            }
          />
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: StockAlertRow["status"] }) {
  const isCritical = status === "Critical";
  const isWarning = status === "Warning";

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        background: isCritical ? "#fde8e8" : isWarning ? "#fff4d6" : "#e8f5e9",
        color: isCritical ? "#8a1f11" : isWarning ? "#7a4b00" : "#1f6f3d",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function Table({
  headers,
  rows,
  maxHeight = 320,
}: {
  headers: string[];
  rows: Array<Array<string | number | React.ReactNode>>;
  maxHeight?: number;
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight,
        border: "1px solid #f0f0f0",
        borderRadius: 14,
        marginTop: 14,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          background: "white",
        }}
      >
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: "left",
                  padding: "12px 10px",
                  borderBottom: "1px solid #dcdcdc",
                  color: "#4b5563",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  position: "sticky",
                  top: 0,
                  background: "#fafafa",
                  zIndex: 1,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      padding: "11px 10px",
                      borderBottom: "1px solid #f0f0f0",
                      verticalAlign: "top",
                      color: "#202223",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                style={{
                  padding: 16,
                  color: "#6b7280",
                }}
              >
                No data for this location and period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function LiveDashboardPage() {
  const {
    locations,
    selectedLocationId,
    selectedLocationName,
    startDate,
    endDate,
    selectedDays,
    kpis,
    topProducts,
    stockAlerts,
    vendorSummary,
    staffSummary,
    recentOrders,
  } = useLoaderData<LoaderData>();

  const navigate = useNavigate();

  function updateFilters(nextLocationId: string, nextStartDate: string, nextEndDate: string) {
    navigate(
      `/app/live-dashboard?locationId=${encodeURIComponent(
        nextLocationId,
      )}&startDate=${encodeURIComponent(nextStartDate)}&endDate=${encodeURIComponent(nextEndDate)}`,
    );
  }

  function setToday() {
    const today = getTodayLocalDate();
    updateFilters(selectedLocationId ?? "", today, today);
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
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        <header
          style={{
            marginBottom: 24,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ color: "#5f6368", fontSize: 14, marginBottom: 6, fontWeight: 700 }}>
            Live Shopify data
          </div>

          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 850 }}>
            Store dashboard
          </h1>

          <p style={{ marginTop: 8, color: "#6b7280", fontSize: 16 }}>
            Sales, margin and operational risks by location.
          </p>

          <Form method="get">
            <div
              style={{
                marginTop: 18,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 14,
                alignItems: "end",
              }}
            >
              <div>
                <label htmlFor="locationId" style={{ display: "block", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                  Location
                </label>
                <select
                  id="locationId"
                  name="locationId"
                  value={selectedLocationId ?? ""}
                  onChange={(event) => updateFilters(event.target.value, startDate, endDate)}
                  style={{ width: "100%", padding: "11px 12px", borderRadius: 12, border: "1px solid #c9c9c9", background: "white", fontSize: 14, minHeight: 44 }}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="startDate" style={{ display: "block", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                  Start date
                </label>
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  value={startDate}
                  onChange={(event) => updateFilters(selectedLocationId ?? "", event.target.value, endDate)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #c9c9c9", background: "white", fontSize: 14, minHeight: 44 }}
                />
              </div>

              <div>
                <label htmlFor="endDate" style={{ display: "block", fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
                  End date
                </label>
                <input
                  id="endDate"
                  name="endDate"
                  type="date"
                  value={endDate}
                  onChange={(event) => updateFilters(selectedLocationId ?? "", startDate, event.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #c9c9c9", background: "white", fontSize: 14, minHeight: 44 }}
                />
              </div>

              <button
                type="button"
                onClick={setToday}
                style={{ border: "1px solid #202223", background: "#202223", color: "white", borderRadius: 12, padding: "11px 16px", fontSize: 14, fontWeight: 800, cursor: "pointer", minHeight: 44 }}
              >
                Today
              </button>

              <button
                type="submit"
                style={{ border: "1px solid #c9c9c9", background: "white", borderRadius: 12, padding: "11px 16px", fontSize: 14, fontWeight: 800, cursor: "pointer", minHeight: 44 }}
              >
                Apply
              </button>
            </div>
          </Form>

          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span style={{ background: "#fafafa", border: "1px solid #e3e3e3", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 800 }}>
              Current location: {selectedLocationName ?? "-"}
            </span>
            <span style={{ background: "#fafafa", border: "1px solid #e3e3e3", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 800 }}>
              Range: {startDate} → {endDate}
            </span>
            <span style={{ background: "#fafafa", border: "1px solid #e3e3e3", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 800 }}>
              {selectedDays} day{selectedDays > 1 ? "s" : ""}
            </span>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 22 }}>
          <KpiCard title="Revenue" value={formatCurrency(kpis.revenue)} subtitle="Retail sales linked to this location" exportValue={kpis.revenue} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Orders" value={String(kpis.ordersCount)} subtitle="Unique orders for this location" exportValue={kpis.ordersCount} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Units sold" value={String(kpis.unitsSold)} subtitle="Quantity sold from order lines" exportValue={kpis.unitsSold} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="COGS" value={formatCurrency(kpis.cogs)} subtitle="Product costs for sold items" exportValue={kpis.cogs} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Gross profit" value={formatCurrency(kpis.grossProfit)} subtitle="Revenue minus COGS" exportValue={kpis.grossProfit} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Gross margin" value={formatPercent(kpis.grossMarginPct)} subtitle="Gross profit divided by revenue" exportValue={kpis.grossMarginPct} selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Expenses" value="Not configured" subtitle="Requires expenses settings page" exportValue="Not configured" selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
          <KpiCard title="Net profit" value="Not available" subtitle="Requires configured expenses" exportValue="Not available" selectedLocationName={selectedLocationName} startDate={startDate} endDate={endDate} />
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, marginBottom: 20 }}>
          <SectionCard title="Best sellers" exportConfig={{ filename: "best-sellers.csv", headers: ["Product", "SKU", "Vendor", "Units", "Revenue"], rows: topProducts.map((row) => [row.productTitle, row.sku, row.vendor, row.unitsSold, row.revenue]) }}>
            <Table headers={["Product", "SKU", "Vendor", "Units", "Revenue"]} rows={topProducts.map((row) => [row.productTitle, row.sku, row.vendor, row.unitsSold, formatCurrency(row.revenue)])} />
          </SectionCard>

          <SectionCard
            title="Soon out of stock"
            helperText="Uses recent sales velocity: average daily sales = units sold in the selected date range ÷ number of days. Days left = available stock ÷ average daily sales. Critical ≤ 3 days, Warning ≤ 7 days."
            exportConfig={{ filename: "soon-out-of-stock.csv", headers: ["Product", "SKU", "Available", "Sold", "Days left", "Status"], rows: stockAlerts.map((row) => [row.productTitle, row.sku, row.available, row.unitsSold, row.daysOfStock === null ? "-" : row.daysOfStock.toFixed(1), row.status]) }}
          >
            <Table headers={["Product", "SKU", "Available", "Sold", "Days left", "Status"]} rows={stockAlerts.map((row) => [row.productTitle, row.sku, row.available, row.unitsSold, row.daysOfStock === null ? "-" : row.daysOfStock.toFixed(1), <StatusBadge key={`${row.sku}-${row.status}`} status={row.status} />])} />
          </SectionCard>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, marginBottom: 20 }}>
          <SectionCard title="Sales by vendor" exportConfig={{ filename: "sales-by-vendor.csv", headers: ["Vendor", "Units", "Revenue"], rows: vendorSummary.map((row) => [row.vendor, row.unitsSold, row.revenue]) }}>
            <Table headers={["Vendor", "Units", "Revenue"]} rows={vendorSummary.map((row) => [row.vendor, row.unitsSold, formatCurrency(row.revenue)])} />
          </SectionCard>

          <SectionCard title="Sales by staff" helperText="This depends on Shopify POS staff attribution. If empty, Shopify is not returning staff attribution through the current API access." exportConfig={{ filename: "sales-by-staff.csv", headers: ["Staff", "Revenue", "Orders", "Units sold"], rows: staffSummary.map((row) => [row.staffName, row.revenue, row.ordersCount, row.unitsSold]) }}>
            <Table headers={["Staff", "Revenue", "Orders", "Units sold"]} rows={staffSummary.map((row) => [row.staffName, formatCurrency(row.revenue), row.ordersCount, row.unitsSold])} />
          </SectionCard>
        </div>

        <SectionCard title="Recent order lines" exportConfig={{ filename: "recent-order-lines.csv", headers: ["Order", "Date", "Product", "SKU", "Qty", "Revenue", "COGS", "Gross profit", "Staff", "Order URL"], rows: recentOrders.map((row) => [row.orderName, formatDate(row.createdAt), row.productTitle, row.sku, row.quantity, row.revenue, row.cogs, row.grossProfit, row.staffName, row.orderUrl]) }}>
          <Table maxHeight={420} headers={["Order", "Date", "Product", "SKU", "Qty", "Revenue", "COGS", "Gross profit", "Staff"]} rows={recentOrders.map((row) => [
            <a key={row.orderId} href={row.orderUrl} target="_top" style={{ color: "#005bd3", fontWeight: 800, textDecoration: "none" }}>{row.orderName}</a>,
            formatDate(row.createdAt),
            row.productTitle,
            row.sku,
            row.quantity,
            formatCurrency(row.revenue),
            formatCurrency(row.cogs),
            formatCurrency(row.grossProfit),
            row.staffName,
          ])} />
        </SectionCard>
      </div>
    </main>
  );
}

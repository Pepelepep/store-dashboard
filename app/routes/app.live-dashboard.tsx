import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";

import { authenticate } from "../shopify.server";

type PeriodKey = "today"| "7d" | "30d" | "90d";

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
  revenue: number;
  locationId: string;
  locationName: string;
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
};

type TopProductRow = {
  productTitle: string;
  sku: string;
  vendor: string;
  unitsSold: number;
  revenue: number;
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
  unitsSold: number;
  inventoryUnits: number;
  lowStockSkus: number;
};

type SlowMoverRow = {
  productTitle: string;
  variantTitle: string;
  sku: string;
  vendor: string;
  available: number;
};

type LoaderData = {
  locations: LocationNode[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  selectedPeriod: PeriodKey;
  periodLabel: string;
  startDate: string;
  endDate: string;
  kpis: {
    revenue: number;
    ordersCount: number;
    unitsSold: number;
    averageOrderValue: number;
    inventoryUnits: number;
    lowStockCount: number;
    criticalStockCount: number;
  };
  topProducts: TopProductRow[];
  stockAlerts: StockAlertRow[];
  vendorSummary: VendorSummaryRow[];
  slowMovers: SlowMoverRow[];
  recentOrders: OrderLineRow[];
  errors?: unknown[];
};

const periodOptions: { label: string; value: PeriodKey; days: number }[] = [
  { label: "Today", value: "today", days: 1 },
  { label: "Last 7 days", value: "7d", days: 7 },
  { label: "Last 30 days", value: "30d", days: 30 },
  { label: "Last 90 days", value: "90d", days: 90 },
];

function getPeriodConfig(period: string | null) {
  return (
    periodOptions.find((option) => option.value === period) ?? periodOptions[1]
  );
}

function getPeriodRange(period: PeriodKey) {
  const config = getPeriodConfig(period);
  const endDate = new Date();
  const startDate = new Date();

  startDate.setDate(endDate.getDate() - config.days);

  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    days: config.days,
    label: config.label,
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

function computeTopProducts(orderRows: OrderLineRow[]): TopProductRow[] {
  const totalRevenue = orderRows.reduce((sum, row) => sum + row.revenue, 0);
  const grouped = new Map<string, Omit<TopProductRow, "revenueSharePct">>();

  for (const row of orderRows) {
    const key = `${row.productTitle}__${row.sku}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.unitsSold += row.quantity;
      existing.revenue += row.revenue;
    } else {
      grouped.set(key, {
        productTitle: row.productTitle,
        sku: row.sku,
        vendor: row.vendor,
        unitsSold: row.quantity,
        revenue: row.revenue,
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
        unitsSold: 0,
        inventoryUnits: 0,
        lowStockSkus: 0,
      } satisfies VendorSummaryRow);

    existing.revenue += row.revenue;
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
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeSlowMovers(
  inventoryRows: InventoryRow[],
  orderRows: OrderLineRow[],
): SlowMoverRow[] {
  const soldSkus = new Set(orderRows.map((row) => row.sku));

  return inventoryRows
    .filter((row) => row.available > 0 && !soldSkus.has(row.sku))
    .sort((a, b) => b.available - a.available)
    .slice(0, 15)
    .map((row) => ({
      productTitle: row.productTitle,
      variantTitle: row.variantTitle,
      sku: row.sku,
      vendor: row.vendor,
      available: row.available,
    }));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const requestedLocationId = url.searchParams.get("locationId");
  const selectedPeriod = getPeriodConfig(url.searchParams.get("period")).value;
  const periodRange = getPeriodRange(selectedPeriod);

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

  if (!selectedLocationId) {
    return {
      locations: activeLocations,
      selectedLocationId: null,
      selectedLocationName: null,
      selectedPeriod,
      periodLabel: periodRange.label,
      startDate: periodRange.startDate,
      endDate: periodRange.endDate,
      kpis: {
        revenue: 0,
        ordersCount: 0,
        unitsSold: 0,
        averageOrderValue: 0,
        inventoryUnits: 0,
        lowStockCount: 0,
        criticalStockCount: 0,
      },
      topProducts: [],
      stockAlerts: [],
      vendorSummary: [],
      slowMovers: [],
      recentOrders: [],
      errors: locationsData.errors ? [locationsData.errors] : undefined,
    };
  }

  const orderQuery = `created_at:>=${periodRange.startDate} created_at:<=${periodRange.endDate}`;

  const [ordersResponse, inventoryResponse] = await Promise.all([
    admin.graphql(
      `#graphql
        query getRecentOrdersForDashboard($query: String!) {
          orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $query) {
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
        products(first: 15) {
          edges {
            node {
              id
              title
              vendor
              variants(first: 25) {
                edges {
                  node {
                    id
                    title
                    sku
                    inventoryItem {
                      id
                      sku
                      tracked
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

  const orderRows: OrderLineRow[] = orders.flatMap((order) => {
    if (order.retailLocation?.id !== selectedLocationId) {
      return [];
    }

    return order.lineItems.edges.map(({ node: lineItem }) => {
      const unitPrice = Number(
        lineItem.discountedUnitPriceSet?.shopMoney?.amount ?? 0,
      );

      return {
        orderId: order.id,
        orderName: order.name,
        createdAt: order.createdAt,
        productTitle: lineItem.variant?.product?.title ?? lineItem.title,
        variantTitle: lineItem.variant?.title ?? "-",
        sku: lineItem.sku ?? lineItem.variant?.sku ?? "-",
        vendor: lineItem.variant?.product?.vendor ?? "-",
        quantity: lineItem.quantity,
        unitPrice,
        revenue: unitPrice * lineItem.quantity,
        locationId: order.retailLocation?.id ?? "-",
        locationName: order.retailLocation?.name ?? "-",
      };
    });
  });

  const inventoryRows: InventoryRow[] = products.flatMap((product) =>
    product.variants.edges.flatMap(({ node: variant }) => {
      const inventoryItem = variant.inventoryItem;

      if (!inventoryItem) {
        return [];
      }

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
          },
        ];
      });
    }),
  );

  const revenue = orderRows.reduce((sum, row) => sum + row.revenue, 0);
  const unitsSold = orderRows.reduce((sum, row) => sum + row.quantity, 0);
  const uniqueOrders = new Set(orderRows.map((row) => row.orderId));
  const ordersCount = uniqueOrders.size;
  const averageOrderValue = ordersCount > 0 ? revenue / ordersCount : 0;
  const inventoryUnits = inventoryRows.reduce(
    (sum, row) => sum + row.available,
    0,
  );

  const stockAlerts = computeStockAlerts(
    inventoryRows,
    orderRows,
    periodRange.days,
  );

  const lowStockCount = stockAlerts.filter(
    (row) => row.status === "Critical" || row.status === "Warning",
  ).length;

  const criticalStockCount = stockAlerts.filter(
    (row) => row.status === "Critical",
  ).length;

  const errors = [locationsData.errors, ordersData.errors, inventoryData.errors]
    .filter(Boolean)
    .flat();

  return {
    locations: activeLocations,
    selectedLocationId,
    selectedLocationName,
    selectedPeriod,
    periodLabel: periodRange.label,
    startDate: periodRange.startDate,
    endDate: periodRange.endDate,
    kpis: {
      revenue,
      ordersCount,
      unitsSold,
      averageOrderValue,
      inventoryUnits,
      lowStockCount,
      criticalStockCount,
    },
    topProducts: computeTopProducts(orderRows),
    stockAlerts,
    vendorSummary: computeVendorSummary(orderRows, inventoryRows),
    slowMovers: computeSlowMovers(inventoryRows, orderRows),
    recentOrders: orderRows.slice(0, 25),
    errors: errors.length > 0 ? errors : undefined,
  };
}

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ color: "#616161", fontSize: 14, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ color: "#707070", fontSize: 13 }}>{subtitle}</div>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 16,
        padding: 22,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: 20 }}>{title}</h2>
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
}: {
  headers: string[];
  rows: Array<Array<string | number | React.ReactNode>>;
}) {
  return (
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
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: "left",
                  padding: "12px 10px",
                  borderBottom: "1px solid #dcdcdc",
                  color: "#616161",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
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
                      padding: "12px 10px",
                      borderBottom: "1px solid #f0f0f0",
                      verticalAlign: "top",
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
                  color: "#707070",
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
    selectedPeriod,
    periodLabel,
    startDate,
    endDate,
    kpis,
    topProducts,
    stockAlerts,
    vendorSummary,
    slowMovers,
    recentOrders,
    errors,
  } = useLoaderData<LoaderData>();

  const navigate = useNavigate();

  function updateFilters(nextLocationId: string, nextPeriod: string) {
    navigate(
      `/app/live-dashboard?locationId=${encodeURIComponent(
        nextLocationId,
      )}&period=${encodeURIComponent(nextPeriod)}`,
    );
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
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ color: "#616161", fontSize: 14, marginBottom: 6 }}>
            Live Shopify data
          </div>

          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 750 }}>
            Store dashboard
          </h1>

          <p style={{ marginTop: 8, color: "#616161", fontSize: 16 }}>
            Sales, inventory, best sellers and stock risks by location.
          </p>

          <div
            style={{
              marginTop: 18,
              display: "grid",
              gridTemplateColumns: "minmax(220px, 340px) minmax(160px, 220px)",
              gap: 14,
              alignItems: "end",
            }}
          >
            <div>
              <label
                htmlFor="location"
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Location
              </label>

              <select
                id="location"
                value={selectedLocationId ?? ""}
                onChange={(event) =>
                  updateFilters(event.target.value, selectedPeriod)
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #c9c9c9",
                  background: "white",
                  fontSize: 14,
                }}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="period"
                style={{
                  display: "block",
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                Period
              </label>

              <select
                id="period"
                value={selectedPeriod}
                onChange={(event) =>
                  updateFilters(selectedLocationId ?? "", event.target.value)
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #c9c9c9",
                  background: "white",
                  fontSize: 14,
                }}
              >
                {periodOptions.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span
              style={{
                background: "white",
                border: "1px solid #e3e3e3",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Current location: {selectedLocationName ?? "-"}
            </span>

            <span
              style={{
                background: "white",
                border: "1px solid #e3e3e3",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Period: {periodLabel}
            </span>

            <span
              style={{
                background: "white",
                border: "1px solid #e3e3e3",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {startDate} → {endDate}
            </span>
          </div>

          <div
            style={{
              marginTop: 16,
              background: "#fff8e5",
              border: "1px solid #f1c96b",
              borderRadius: 14,
              padding: 14,
              color: "#5f4200",
              fontSize: 14,
            }}
          >
            Sales source: POS / retail location only. Online orders are not
            included in this location view yet.
          </div>
        </header>

        {errors ? (
          <section
            style={{
              background: "#fff4f4",
              border: "1px solid #f2b8b5",
              borderRadius: 14,
              padding: 18,
              marginBottom: 20,
            }}
          >
            <strong>GraphQL errors</strong>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(errors, null, 2)}
            </pre>
          </section>
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 22,
          }}
        >
          <KpiCard
            title="Revenue"
            value={formatCurrency(kpis.revenue)}
            subtitle="Retail sales linked to this location"
          />
          <KpiCard
            title="Orders"
            value={String(kpis.ordersCount)}
            subtitle="Unique orders for this location"
          />
          <KpiCard
            title="Units sold"
            value={String(kpis.unitsSold)}
            subtitle="Quantity sold from order lines"
          />
          <KpiCard
            title="Average order value"
            value={formatCurrency(kpis.averageOrderValue)}
            subtitle="Revenue divided by orders"
          />
          <KpiCard
            title="Inventory units"
            value={formatNumber(kpis.inventoryUnits)}
            subtitle="Available stock at this location"
          />
          <KpiCard
            title="Critical SKUs"
            value={String(kpis.criticalStockCount)}
            subtitle="Estimated stock coverage ≤ 3 days"
          />
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <SectionCard title="Best sellers">
            <Table
              headers={[
                "Product",
                "SKU",
                "Vendor",
                "Units sold",
                "Revenue",
                "% sales",
              ]}
              rows={topProducts.map((row) => [
                row.productTitle,
                row.sku,
                row.vendor,
                row.unitsSold,
                formatCurrency(row.revenue),
                `${row.revenueSharePct.toFixed(1)}%`,
              ])}
            />
          </SectionCard>

          <SectionCard title="Soon out of stock">
            <Table
              headers={[
                "Product",
                "SKU",
                "Available",
                "Sold",
                "Days left",
                "Status",
              ]}
              rows={stockAlerts.map((row) => [
                row.productTitle,
                row.sku,
                row.available,
                row.unitsSold,
                row.daysOfStock === null
                  ? "-"
                  : row.daysOfStock.toFixed(1),
                <StatusBadge key={`${row.sku}-${row.status}`} status={row.status} />,
              ])}
            />
          </SectionCard>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <SectionCard title="Sales by vendor">
            <Table
              headers={[
                "Vendor",
                "Revenue",
                "Units sold",
                "Inventory units",
                "Low stock SKUs",
              ]}
              rows={vendorSummary.map((row) => [
                row.vendor,
                formatCurrency(row.revenue),
                row.unitsSold,
                row.inventoryUnits,
                row.lowStockSkus,
              ])}
            />
          </SectionCard>

          <SectionCard title="Slow movers">
            <Table
              headers={["Product", "Variant", "SKU", "Vendor", "Available"]}
              rows={slowMovers.map((row) => [
                row.productTitle,
                row.variantTitle,
                row.sku,
                row.vendor,
                row.available,
              ])}
            />
          </SectionCard>
        </div>

        <SectionCard title="Recent order lines">
          <Table
            headers={["Order", "Date", "Product", "SKU", "Qty", "Revenue"]}
            rows={recentOrders.map((row) => [
              row.orderName,
              formatDate(row.createdAt),
              row.productTitle,
              row.sku,
              row.quantity,
              formatCurrency(row.revenue),
            ])}
          />
        </SectionCard>
      </div>
    </main>
  );
}
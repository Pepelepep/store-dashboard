import { useMemo, useState, type ReactNode } from "react";

type LocationId = "vieux-port" | "laval" | "downtown" | "online";

const locations: { id: LocationId; name: string }[] = [
  { id: "vieux-port", name: "Vieux-Port" },
  { id: "laval", name: "Laval" },
  { id: "downtown", name: "Downtown" },
  { id: "online", name: "Online" },
];

const mockKpisByLocation: Record<
  LocationId,
  {
    revenue: number;
    ordersCount: number;
    unitsSold: number;
    averageOrderValue: number;
    grossProfit: number;
    grossMarginPct: number;
  }
> = {
  "vieux-port": {
    revenue: 12540,
    ordersCount: 186,
    unitsSold: 432,
    averageOrderValue: 67.42,
    grossProfit: 4820,
    grossMarginPct: 38.4,
  },
  laval: {
    revenue: 8240,
    ordersCount: 121,
    unitsSold: 284,
    averageOrderValue: 68.1,
    grossProfit: 3020,
    grossMarginPct: 36.7,
  },
  downtown: {
    revenue: 9750,
    ordersCount: 144,
    unitsSold: 318,
    averageOrderValue: 67.71,
    grossProfit: 3910,
    grossMarginPct: 40.1,
  },
  online: {
    revenue: 6420,
    ordersCount: 98,
    unitsSold: 210,
    averageOrderValue: 65.51,
    grossProfit: 2460,
    grossMarginPct: 38.3,
  },
};

const topProducts = [
  {
    locationId: "vieux-port",
    product: "T-shirt Local",
    sku: "TS-LOCAL-BLK-M",
    vendor: "Local",
    unitsSold: 86,
    revenue: 2580,
    marginPct: 42.1,
  },
  {
    locationId: "vieux-port",
    product: "Casquette Logo",
    sku: "CAP-LOGO-BLK",
    vendor: "Local",
    unitsSold: 41,
    revenue: 1230,
    marginPct: 48.5,
  },
  {
    locationId: "vieux-port",
    product: "Totebag",
    sku: "BAG-TOTE-WHT",
    vendor: "Maison Local",
    unitsSold: 32,
    revenue: 640,
    marginPct: 51.2,
  },
  {
    locationId: "laval",
    product: "Hoodie Premium",
    sku: "HD-PREM-GRY-L",
    vendor: "Local",
    unitsSold: 54,
    revenue: 3240,
    marginPct: 36.8,
  },
  {
    locationId: "laval",
    product: "Crewneck Laval",
    sku: "CR-LAV-NVY-M",
    vendor: "Maison Local",
    unitsSold: 38,
    revenue: 2280,
    marginPct: 35.2,
  },
  {
    locationId: "downtown",
    product: "Cap Downtown",
    sku: "CAP-DTN-BLK",
    vendor: "Local",
    unitsSold: 62,
    revenue: 1860,
    marginPct: 44.9,
  },
  {
    locationId: "downtown",
    product: "T-shirt Downtown",
    sku: "TS-DTN-WHT-L",
    vendor: "Local",
    unitsSold: 49,
    revenue: 1470,
    marginPct: 39.4,
  },
  {
    locationId: "online",
    product: "Online Bundle",
    sku: "BNDL-ONLINE-01",
    vendor: "Local",
    unitsSold: 44,
    revenue: 3520,
    marginPct: 41.6,
  },
  {
    locationId: "online",
    product: "Sticker Pack",
    sku: "STK-PACK-01",
    vendor: "Maison Local",
    unitsSold: 91,
    revenue: 455,
    marginPct: 62.3,
  },
] satisfies Array<{
  locationId: LocationId;
  product: string;
  sku: string;
  vendor: string;
  unitsSold: number;
  revenue: number;
  marginPct: number;
}>;

const inventoryAlerts = [
  {
    locationId: "vieux-port",
    product: "T-shirt Local",
    sku: "TS-LOCAL-BLK-M",
    available: 7,
    avgDailySales: 4.3,
    daysOfStock: 1.6,
    status: "Critical",
  },
  {
    locationId: "vieux-port",
    product: "Casquette Logo",
    sku: "CAP-LOGO-BLK",
    available: 0,
    avgDailySales: 1.8,
    daysOfStock: 0,
    status: "Out of stock",
  },
  {
    locationId: "laval",
    product: "Hoodie Premium",
    sku: "HD-PREM-GRY-L",
    available: 14,
    avgDailySales: 2.1,
    daysOfStock: 6.7,
    status: "Warning",
  },
  {
    locationId: "laval",
    product: "Crewneck Laval",
    sku: "CR-LAV-NVY-M",
    available: 22,
    avgDailySales: 1.4,
    daysOfStock: 15.7,
    status: "Healthy",
  },
  {
    locationId: "downtown",
    product: "Cap Downtown",
    sku: "CAP-DTN-BLK",
    available: 5,
    avgDailySales: 3.4,
    daysOfStock: 1.5,
    status: "Critical",
  },
  {
    locationId: "online",
    product: "Online Bundle",
    sku: "BNDL-ONLINE-01",
    available: 11,
    avgDailySales: 2.7,
    daysOfStock: 4.1,
    status: "Warning",
  },
] satisfies Array<{
  locationId: LocationId;
  product: string;
  sku: string;
  available: number;
  avgDailySales: number;
  daysOfStock: number;
  status: string;
}>;

const vendorPerformance = [
  {
    locationId: "vieux-port",
    vendor: "Local",
    revenue: 9250,
    grossProfit: 3580,
    marginPct: 38.7,
    stockValue: 6840,
  },
  {
    locationId: "vieux-port",
    vendor: "Maison Local",
    revenue: 3290,
    grossProfit: 1240,
    marginPct: 37.7,
    stockValue: 3120,
  },
  {
    locationId: "laval",
    vendor: "Local",
    revenue: 6020,
    grossProfit: 2180,
    marginPct: 36.2,
    stockValue: 5240,
  },
  {
    locationId: "laval",
    vendor: "Maison Local",
    revenue: 2220,
    grossProfit: 840,
    marginPct: 37.8,
    stockValue: 2760,
  },
  {
    locationId: "downtown",
    vendor: "Local",
    revenue: 7110,
    grossProfit: 2890,
    marginPct: 40.6,
    stockValue: 4460,
  },
  {
    locationId: "downtown",
    vendor: "Maison Local",
    revenue: 2640,
    grossProfit: 1020,
    marginPct: 38.6,
    stockValue: 2380,
  },
  {
    locationId: "online",
    vendor: "Local",
    revenue: 4980,
    grossProfit: 1910,
    marginPct: 38.4,
    stockValue: 3180,
  },
  {
    locationId: "online",
    vendor: "Maison Local",
    revenue: 1440,
    grossProfit: 550,
    marginPct: 38.2,
    stockValue: 1560,
  },
] satisfies Array<{
  locationId: LocationId;
  vendor: string;
  revenue: number;
  grossProfit: number;
  marginPct: number;
  stockValue: number;
}>;

const recommendations = [
  {
    locationId: "vieux-port",
    priority: "High",
    product: "T-shirt Local",
    reason: "Fast sales velocity and low stock at Vieux-Port",
    suggestedOrderQty: 60,
  },
  {
    locationId: "vieux-port",
    priority: "High",
    product: "Casquette Logo",
    reason: "Currently out of stock at Vieux-Port",
    suggestedOrderQty: 40,
  },
  {
    locationId: "laval",
    priority: "Medium",
    product: "Hoodie Premium",
    reason: "Stock covers less than one week in Laval",
    suggestedOrderQty: 30,
  },
  {
    locationId: "downtown",
    priority: "High",
    product: "Cap Downtown",
    reason: "High velocity and very low stock downtown",
    suggestedOrderQty: 50,
  },
  {
    locationId: "online",
    priority: "Medium",
    product: "Online Bundle",
    reason: "Online stock covers less than five days",
    suggestedOrderQty: 35,
  },
] satisfies Array<{
  locationId: LocationId;
  priority: string;
  product: string;
  reason: string;
  suggestedOrderQty: number;
}>;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
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
        borderRadius: 14,
        padding: 20,
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
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
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        padding: 24,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 18, fontSize: 20 }}>{title}</h2>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase();

  const isCritical =
    normalizedStatus === "critical" ||
    normalizedStatus === "out of stock" ||
    normalizedStatus === "high";

  const isWarning =
    normalizedStatus === "warning" || normalizedStatus === "medium";

  const background = isCritical ? "#fde8e8" : isWarning ? "#fff4d6" : "#e8f5e9";
  const color = isCritical ? "#8a1f11" : isWarning ? "#7a4b00" : "#1f6f3d";

  return (
    <span
      style={{
        background,
        color,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
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
                  borderBottom: "1px solid #e3e3e3",
                  color: "#616161",
                  fontWeight: 700,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      padding: "12px 10px",
                      borderBottom: "1px solid #f0f0f0",
                      verticalAlign: "middle",
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
                  padding: "18px 10px",
                  color: "#707070",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                No data for this location.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LocationSelector({
  selectedLocationId,
  onSelectLocation,
}: {
  selectedLocationId: LocationId;
  onSelectLocation: (locationId: LocationId) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 18,
      }}
    >
      {locations.map((location) => {
        const isSelected = location.id === selectedLocationId;

        return (
          <button
            key={location.id}
            type="button"
            onClick={() => onSelectLocation(location.id)}
            style={{
              border: isSelected ? "1px solid #202223" : "1px solid #dcdcdc",
              background: isSelected ? "#202223" : "white",
              color: isSelected ? "white" : "#202223",
              borderRadius: 999,
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {location.name}
          </button>
        );
      })}
    </div>
  );
}

export default function PreviewDashboard() {
  const [selectedLocationId, setSelectedLocationId] =
    useState<LocationId>("vieux-port");

  const selectedLocation = locations.find(
    (location) => location.id === selectedLocationId,
  );

  const mockKpis = mockKpisByLocation[selectedLocationId];

  const filteredTopProducts = useMemo(
    () => topProducts.filter((row) => row.locationId === selectedLocationId),
    [selectedLocationId],
  );

  const filteredInventoryAlerts = useMemo(
    () =>
      inventoryAlerts.filter((row) => row.locationId === selectedLocationId),
    [selectedLocationId],
  );

  const filteredVendorPerformance = useMemo(
    () =>
      vendorPerformance.filter((row) => row.locationId === selectedLocationId),
    [selectedLocationId],
  );

  const filteredRecommendations = useMemo(
    () =>
      recommendations.filter((row) => row.locationId === selectedLocationId),
    [selectedLocationId],
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f6f7",
        padding: 32,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ color: "#616161", fontSize: 14, marginBottom: 6 }}>
            Preview mode
          </div>

          <h1 style={{ margin: 0, fontSize: 32 }}>Store dashboard</h1>

          <p style={{ marginTop: 8, color: "#616161", fontSize: 16 }}>
            Sales, inventory and profitability overview by location.
          </p>

          <div
            style={{
              marginTop: 16,
              display: "inline-flex",
              gap: 8,
              alignItems: "center",
              background: "white",
              border: "1px solid #e3e3e3",
              borderRadius: 999,
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Current location: {selectedLocation?.name}
          </div>

          <LocationSelector
            selectedLocationId={selectedLocationId}
            onSelectLocation={setSelectedLocationId}
          />
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <KpiCard
            title="Revenue"
            value={formatCurrency(mockKpis.revenue)}
            subtitle={`Sales revenue for ${selectedLocation?.name}`}
          />
          <KpiCard
            title="Orders"
            value={String(mockKpis.ordersCount)}
            subtitle={`Number of orders for ${selectedLocation?.name}`}
          />
          <KpiCard
            title="Units sold"
            value={String(mockKpis.unitsSold)}
            subtitle={`Total quantity sold for ${selectedLocation?.name}`}
          />
          <KpiCard
            title="Average order value"
            value={formatCurrency(mockKpis.averageOrderValue)}
            subtitle="Revenue divided by orders"
          />
          <KpiCard
            title="Gross profit"
            value={formatCurrency(mockKpis.grossProfit)}
            subtitle="Revenue minus estimated product costs"
          />
          <KpiCard
            title="Gross margin"
            value={`${mockKpis.grossMarginPct}%`}
            subtitle="Gross profit divided by revenue"
          />
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.9fr)",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <SectionCard title="Top products">
            <DataTable
              headers={[
                "Product",
                "SKU",
                "Vendor",
                "Units sold",
                "Revenue",
                "Margin",
              ]}
              rows={filteredTopProducts.map((row) => [
                row.product,
                row.sku,
                row.vendor,
                row.unitsSold,
                formatCurrency(row.revenue),
                `${row.marginPct}%`,
              ])}
            />
          </SectionCard>

          <SectionCard title="Inventory alerts">
            <DataTable
              headers={["Product", "Available", "Days", "Status"]}
              rows={filteredInventoryAlerts.map((row) => [
                <div key={row.sku}>
                  <div style={{ fontWeight: 700 }}>{row.product}</div>
                  <div style={{ color: "#707070", fontSize: 12 }}>
                    {row.sku}
                  </div>
                </div>,
                row.available,
                row.daysOfStock,
                <StatusBadge key={row.status} status={row.status} />,
              ])}
            />
          </SectionCard>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 20,
          }}
        >
          <SectionCard title="Profitability by vendor">
            <DataTable
              headers={[
                "Vendor",
                "Revenue",
                "Gross profit",
                "Margin",
                "Stock value",
              ]}
              rows={filteredVendorPerformance.map((row) => [
                row.vendor,
                formatCurrency(row.revenue),
                formatCurrency(row.grossProfit),
                `${row.marginPct}%`,
                formatCurrency(row.stockValue),
              ])}
            />
          </SectionCard>

          <SectionCard title="Purchase recommendations">
            <DataTable
              headers={["Priority", "Product", "Reason", "Suggested qty"]}
              rows={filteredRecommendations.map((row) => [
                <StatusBadge key={row.priority} status={row.priority} />,
                row.product,
                row.reason,
                row.suggestedOrderQty,
              ])}
            />
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
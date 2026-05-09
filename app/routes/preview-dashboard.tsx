const mockKpis = {
  revenue: 12540,
  ordersCount: 186,
  unitsSold: 432,
  averageOrderValue: 67.42,
  grossProfit: 4820,
  grossMarginPct: 38.4,
};

const topProducts = [
  {
    product: "T-shirt Local",
    sku: "TS-LOCAL-BLK-M",
    vendor: "Local",
    unitsSold: 86,
    revenue: 2580,
    marginPct: 42.1,
  },
  {
    product: "Hoodie Premium",
    sku: "HD-PREM-GRY-L",
    vendor: "Local",
    unitsSold: 54,
    revenue: 3240,
    marginPct: 36.8,
  },
  {
    product: "Casquette Logo",
    sku: "CAP-LOGO-BLK",
    vendor: "Local",
    unitsSold: 41,
    revenue: 1230,
    marginPct: 48.5,
  },
  {
    product: "Totebag",
    sku: "BAG-TOTE-WHT",
    vendor: "Local",
    unitsSold: 32,
    revenue: 640,
    marginPct: 51.2,
  },
];

const inventoryAlerts = [
  {
    product: "T-shirt Local",
    sku: "TS-LOCAL-BLK-M",
    available: 7,
    avgDailySales: 4.3,
    daysOfStock: 1.6,
    status: "Critical",
  },
  {
    product: "Hoodie Premium",
    sku: "HD-PREM-GRY-L",
    available: 14,
    avgDailySales: 2.1,
    daysOfStock: 6.7,
    status: "Warning",
  },
  {
    product: "Casquette Logo",
    sku: "CAP-LOGO-BLK",
    available: 0,
    avgDailySales: 1.8,
    daysOfStock: 0,
    status: "Out of stock",
  },
];

const vendorPerformance = [
  {
    vendor: "Local",
    revenue: 9250,
    grossProfit: 3580,
    marginPct: 38.7,
    stockValue: 6840,
  },
  {
    vendor: "Maison Local",
    revenue: 3290,
    grossProfit: 1240,
    marginPct: 37.7,
    stockValue: 3120,
  },
];

const recommendations = [
  {
    priority: "High",
    product: "T-shirt Local",
    reason: "Fast sales velocity and low stock",
    suggestedOrderQty: 60,
  },
  {
    priority: "High",
    product: "Casquette Logo",
    reason: "Currently out of stock but still selling recently",
    suggestedOrderQty: 40,
  },
  {
    priority: "Medium",
    product: "Hoodie Premium",
    reason: "Stock covers less than one week",
    suggestedOrderQty: 30,
  },
];

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
  children: React.ReactNode;
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
  const background =
    status === "Critical" || status === "Out of stock"
      ? "#fde8e8"
      : status === "Warning"
        ? "#fff4d6"
        : "#e8f5e9";

  const color =
    status === "Critical" || status === "Out of stock"
      ? "#8a1f11"
      : status === "Warning"
        ? "#7a4b00"
        : "#1f6f3d";

  return (
    <span
      style={{
        background,
        color,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
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
  rows: React.ReactNode[][];
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
          {rows.map((row, rowIndex) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PreviewDashboard() {
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
            Sales, inventory and profitability overview
          </p>
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
            subtitle="Total sales revenue"
          />
          <KpiCard
            title="Orders"
            value={String(mockKpis.ordersCount)}
            subtitle="Number of orders"
          />
          <KpiCard
            title="Units sold"
            value={String(mockKpis.unitsSold)}
            subtitle="Total quantity sold"
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
              rows={topProducts.map((row) => [
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
              rows={inventoryAlerts.map((row) => [
                <div key={row.sku}>
                  <div style={{ fontWeight: 700 }}>{row.product}</div>
                  <div style={{ color: "#707070", fontSize: 12 }}>{row.sku}</div>
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
              headers={["Vendor", "Revenue", "Gross profit", "Margin", "Stock value"]}
              rows={vendorPerformance.map((row) => [
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
              rows={recommendations.map((row) => [
                <StatusBadge key={row.priority} status={row.priority === "High" ? "Critical" : "Warning"} />,
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
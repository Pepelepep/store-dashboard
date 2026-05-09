const mockKpis = {
  revenue: 12540,
  ordersCount: 186,
  unitsSold: 432,
  averageOrderValue: 67.42,
  grossProfit: 4820,
  grossMarginPct: 38.4,
};

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
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 14,
            padding: 24,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Dashboard sections</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginTop: 16,
            }}
          >
            {[
              "Products performance",
              "Inventory overview",
              "Orders analysis",
              "Profitability",
              "Purchase recommendations",
            ].map((item) => (
              <div
                key={item}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: 12,
                  padding: 16,
                  background: "#fafafa",
                  fontWeight: 600,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
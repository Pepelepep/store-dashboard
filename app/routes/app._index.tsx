import { Page, Layout, Card, Text, BlockStack, InlineGrid } from "@shopify/polaris";

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
  helpText,
}: {
  title: string;
  value: string;
  helpText?: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        {helpText ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {helpText}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  return (
    <Page title="Store dashboard" subtitle="Sales, inventory and profitability overview">
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          <KpiCard
            title="Revenue"
            value={formatCurrency(mockKpis.revenue)}
            helpText="Total sales revenue"
          />
          <KpiCard
            title="Orders"
            value={String(mockKpis.ordersCount)}
            helpText="Number of orders"
          />
          <KpiCard
            title="Units sold"
            value={String(mockKpis.unitsSold)}
            helpText="Total quantity sold"
          />
          <KpiCard
            title="Average order value"
            value={formatCurrency(mockKpis.averageOrderValue)}
            helpText="Revenue divided by orders"
          />
          <KpiCard
            title="Gross profit"
            value={formatCurrency(mockKpis.grossProfit)}
            helpText="Revenue minus estimated product costs"
          />
          <KpiCard
            title="Gross margin"
            value={`${mockKpis.grossMarginPct}%`}
            helpText="Gross profit divided by revenue"
          />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Next dashboard sections
                </Text>
                <Text as="p" variant="bodyMd">
                  Products, inventory, profitability and recommendations will be added here.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Card, DataTable, Text, BlockStack } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

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
  displayFinancialStatus?: string | null;
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

type OrderLineLocationRow = {
  orderName: string;
  createdAt: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  vendor: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  retailLocationName: string;
  retailLocationId: string;
  locationSource: "RETAIL" | "UNKNOWN";
  resolvedLocationName: string;
  resolvedLocationId: string;
};

type LoaderData = {
  rows: OrderLineLocationRow[];
  errors?: unknown;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query getRecentOrdersWithRetailLocation {
      orders(first: 25, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
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
  `);

  const data = await response.json();

  const orders: OrderNode[] =
    data.data?.orders?.edges?.map((edge: { node: OrderNode }) => edge.node) ??
    [];

  const rows: OrderLineLocationRow[] = orders.flatMap((order) =>
    order.lineItems.edges.map(({ node: lineItem }) => {
      const unitPrice = Number(
        lineItem.discountedUnitPriceSet?.shopMoney?.amount ?? 0,
      );

      const retailLocation = order.retailLocation ?? null;

      return {
        orderName: order.name,
        createdAt: order.createdAt,
        productTitle: lineItem.variant?.product?.title ?? lineItem.title,
        variantTitle: lineItem.variant?.title ?? "-",
        sku: lineItem.sku ?? lineItem.variant?.sku ?? "-",
        vendor: lineItem.variant?.product?.vendor ?? "-",
        quantity: lineItem.quantity,
        unitPrice,
        revenue: unitPrice * lineItem.quantity,
        retailLocationName: retailLocation?.name ?? "-",
        retailLocationId: retailLocation?.id ?? "-",
        locationSource: retailLocation ? "RETAIL" : "UNKNOWN",
        resolvedLocationName: retailLocation?.name ?? "-",
        resolvedLocationId: retailLocation?.id ?? "-",
      };
    }),
  );

  return {
    rows,
    errors: data.errors,
  };
}

export default function DebugOrdersLocationsPage() {
  const { rows, errors } = useLoaderData<LoaderData>();

  const tableRows = rows.map((row) => [
    row.orderName,
    formatDate(row.createdAt),
    row.productTitle,
    row.variantTitle,
    row.sku,
    row.vendor,
    String(row.quantity),
    formatCurrency(row.revenue),
    row.retailLocationName,
    row.locationSource,
    row.resolvedLocationName,
    row.resolvedLocationId,
  ]);

  return (
    <Page title="Debug - Shopify order locations">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Real Shopify order lines with retail location
            </Text>
            <Text as="p" variant="bodyMd">
              This page checks whether sales can be attributed to the retail/POS location.
            </Text>
          </BlockStack>
        </Card>

        {errors ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd" tone="critical">
                GraphQL errors
              </Text>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(errors, null, 2)}
              </pre>
            </BlockStack>
          </Card>
        ) : null}

        <Card>
          <DataTable
            columnContentTypes={[
              "text",
              "text",
              "text",
              "text",
              "text",
              "text",
              "numeric",
              "numeric",
              "text",
              "text",
              "text",
              "text",
            ]}
            headings={[
              "Order",
              "Date",
              "Product",
              "Variant",
              "SKU",
              "Vendor",
              "Qty",
              "Revenue",
              "Retail location",
              "Source",
              "Resolved location",
              "Resolved location ID",
            ]}
            rows={tableRows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Card, DataTable, Text, BlockStack } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

type InventoryLevelNode = {
  location: {
    id: string;
    name: string;
  };
  quantities: {
    name: string;
    quantity: number;
    updatedAt?: string | null;
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
  productType?: string | null;
  variants: {
    edges: {
      node: VariantNode;
    }[];
  };
};

type InventoryRow = {
  productTitle: string;
  vendor: string;
  variantTitle: string;
  sku: string;
  inventoryItemId: string;
  locationName: string;
  locationId: string;
  available: number;
  tracked: boolean;
};

type LoaderData = {
  rows: InventoryRow[];
  errors?: unknown;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query getInventoryByLocation {
      products(first: 25) {
        edges {
          node {
            id
            title
            vendor
            productType
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                  inventoryItem {
                    id
                    sku
                    tracked
                    inventoryLevels(first: 20) {
                      edges {
                        node {
                          location {
                            id
                            name
                          }
                          quantities(names: ["available"]) {
                            name
                            quantity
                            updatedAt
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
  `);

  const data = await response.json();

  const products: ProductNode[] =
    data.data?.products?.edges?.map(
      (edge: { node: ProductNode }) => edge.node,
    ) ?? [];

  const rows: InventoryRow[] = products.flatMap((product) =>
    product.variants.edges.flatMap(({ node: variant }) => {
      const inventoryItem = variant.inventoryItem;

      if (!inventoryItem) {
        return [];
      }

      return inventoryItem.inventoryLevels.edges.map(({ node: level }) => {
        const availableQuantity =
          level.quantities.find((quantity) => quantity.name === "available")
            ?.quantity ?? 0;

        return {
          productTitle: product.title,
          vendor: product.vendor ?? "-",
          variantTitle: variant.title,
          sku: variant.sku ?? inventoryItem.sku ?? "-",
          inventoryItemId: inventoryItem.id,
          locationName: level.location.name,
          locationId: level.location.id,
          available: availableQuantity,
          tracked: inventoryItem.tracked,
        };
      });
    }),
  );

  return {
    rows,
    errors: data.errors,
  };
}

export default function DebugInventoryPage() {
  const { rows, errors } = useLoaderData<LoaderData>();

  const tableRows = rows.map((row) => [
    row.productTitle,
    row.variantTitle,
    row.sku,
    row.vendor,
    row.locationName,
    String(row.available),
    row.tracked ? "Yes" : "No",
    row.locationId,
    row.inventoryItemId,
  ]);

  return (
    <Page title="Debug - Shopify inventory by location">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Real Shopify inventory by location
            </Text>
            <Text as="p" variant="bodyMd">
              This page reads products, variants, inventory items and available
              quantities by Shopify location.
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
              "numeric",
              "text",
              "text",
              "text",
            ]}
            headings={[
              "Product",
              "Variant",
              "SKU",
              "Vendor",
              "Location",
              "Available",
              "Tracked",
              "Location ID",
              "Inventory item ID",
            ]}
            rows={tableRows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
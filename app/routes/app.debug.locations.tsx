import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Card, DataTable, Text, BlockStack } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

type LocationNode = {
  id: string;
  name: string;
  isActive: boolean;
  address?: {
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
};

type LoaderData = {
  locations: LocationNode[];
  errors?: unknown;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query getLocations {
      locations(first: 50) {
        edges {
          node {
            id
            name
            isActive
            address {
              address1
              city
              province
              country
            }
          }
        }
      }
    }
  `);

  const data = await response.json();

  const locations =
    data.data?.locations?.edges?.map(
      (edge: { node: LocationNode }) => edge.node,
    ) ?? [];

  return {
    locations,
    errors: data.errors,
  };
}

export default function DebugLocationsPage() {
  const { locations, errors } = useLoaderData<LoaderData>();

  const rows = locations.map((location) => [
    location.name,
    location.isActive ? "Active" : "Inactive",
    location.address?.city ?? "-",
    location.address?.province ?? "-",
    location.address?.country ?? "-",
    location.id,
  ]);

  return (
    <Page title="Debug - Shopify locations">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Real Shopify locations
            </Text>
            <Text as="p" variant="bodyMd">
              This page reads locations directly from the connected Shopify store.
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
            columnContentTypes={["text", "text", "text", "text", "text", "text"]}
            headings={[
              "Location",
              "Status",
              "City",
              "Province",
              "Country",
              "Shopify location ID",
            ]}
            rows={rows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
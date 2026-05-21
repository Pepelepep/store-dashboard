import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

type TestResult = {
  label: string;
  ok: boolean;
  errors: unknown;
  data: unknown;
};

type LoaderData = {
  shop: string;
  results: TestResult[];
};

async function runQuery(admin: any, label: string, query: string) {
  try {
    const response = await admin.graphql(query);
    const body = await response.json();

    return {
      label,
      ok: !body.errors,
      errors: body.errors ?? null,
      data: body.data ?? null,
    };
  } catch (error: any) {
    return {
      label,
      ok: false,
      errors: error?.message ?? String(error),
      data: null,
    };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);

  const scopesQuery = `
    query CheckScopes {
      app {
        installation {
          accessScopes {
            handle
          }
        }
      }
    }
  `;

  const staffMembersQuery = `
    query TestStaffMembers {
      staffMembers(first: 10) {
        edges {
          node {
            id
            name
            email
            active
            isShopOwner
          }
        }
      }
    }
  `;

  const orderStaffQuery = `
    query TestOrderStaff {
      orders(first: 10, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            staffMember {
              id
              name
              email
            }
            lineItems(first: 10) {
              edges {
                node {
                  id
                  title
                  quantity
                  staffMember {
                    id
                    name
                    email
                  }
                }
              }
            }
            transactions(first: 10) {
              id
              kind
              status
              user {
                id
                name
                email
              }
            }
          }
        }
      }
    }
  `;

  const results = await Promise.all([
    runQuery(admin, "accessScopes", scopesQuery),
    runQuery(admin, "staffMembers", staffMembersQuery),
    runQuery(admin, "order.staffMember / lineItems.staffMember / transactions.user", orderStaffQuery),
  ]);

  return Response.json({
    shop: session.shop,
    results,
  });
}

export default function StaffTest() {
  const data = useLoaderData<LoaderData>();

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Staff / read_users test</h1>
      <p><strong>Shop:</strong> {data.shop}</p>

      {data.results.map((result) => (
        <section
          key={result.label}
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h2>{result.label}</h2>
          <p>
            Status:{" "}
            <strong style={{ color: result.ok ? "green" : "red" }}>
              {result.ok ? "OK" : "ERROR"}
            </strong>
          </p>
          <pre
            style={{
              background: "#f7f7f7",
              padding: 12,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ))}
    </main>
  );
}

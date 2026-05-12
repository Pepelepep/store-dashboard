import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";

type StaffMemberNode = {
  id: string;
  name?: string | null;
  email?: string | null;
  active?: boolean | null;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  retailLocation?: {
    id: string;
    name: string;
  } | null;
  staffMember?: StaffMemberNode | null;
  transactions?: StaffTransactionNode[];
};

type StaffTransactionNode = {
  id: string;
  kind: string;
  status: string;
  user?: StaffMemberNode | null;
};

type DebugRow = {
  orderName: string;
  createdAt: string;
  retailLocationName: string;
  staffMemberName: string;
  staffMemberEmail: string;
  transactionUsers: string;
};

type LoaderData = {
  rows: DebugRow[];
  errors?: unknown;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query getStaffAttributionDebug {
      orders(first: 25, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            retailLocation {
              id
              name
            }
            staffMember {
              id
              name
              email
              active
            }
            transactions(first: 10) {
              id
              kind
              status
              user {
                id
                name
                email
                active
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

  const rows: DebugRow[] = orders.map((order) => {
    const transactionUsers =
      order.transactions
        ?.map((transaction) => {
          const user = transaction.user;

          if (!user) {
            return `${transaction.kind}: no user`;
          }

          return `${transaction.kind}: ${user.name ?? user.email ?? user.id}`;
        })
        .join(" | ") ?? "-";

    return {
      orderName: order.name,
      createdAt: formatDate(order.createdAt),
      retailLocationName: order.retailLocation?.name ?? "-",
      staffMemberName: order.staffMember?.name ?? "-",
      staffMemberEmail: order.staffMember?.email ?? "-",
      transactionUsers,
    };
  });

  return {
    rows,
    errors: data.errors,
  };
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
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
                  padding: "12px",
                  borderBottom: "1px solid #ddd",
                  whiteSpace: "nowrap",
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
                    padding: "12px",
                    borderBottom: "1px solid #eee",
                    verticalAlign: "top",
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

export default function DebugStaffPage() {
  const { rows, errors } = useLoaderData<LoaderData>();

  return (
    <main
      style={{
        padding: 28,
        background: "#f6f6f7",
        minHeight: "100vh",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Debug - Staff attribution</h1>

      <p style={{ color: "#616161", maxWidth: 900 }}>
        This page tests which staff fields Shopify exposes for recent orders.
        We are checking Order.staffMember and transaction.user.
      </p>

      {errors ? (
        <section
          style={{
            background: "#fff4f4",
            border: "1px solid #f2b8b5",
            borderRadius: 12,
            padding: 16,
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
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 16,
          padding: 20,
        }}
      >
        <Table
          headers={[
            "Order",
            "Created at",
            "Retail location",
            "Order.staffMember name",
            "Order.staffMember email",
            "Transaction users",
          ]}
          rows={rows.map((row) => [
            row.orderName,
            row.createdAt,
            row.retailLocationName,
            row.staffMemberName,
            row.staffMemberEmail,
            row.transactionUsers,
          ])}
        />
      </section>
    </main>
  );
}
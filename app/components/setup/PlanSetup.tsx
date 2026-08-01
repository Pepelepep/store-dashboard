import { Form, Link, useActionData, useNavigation } from "react-router";

import type {
  EntitlementLocation,
  EntitlementMembership,
} from "../../lib/entitlement-model";

export type PlanSetupData = {
  currentPlanName: string;
  state: "active" | "trial" | "canceling";
  trialEndsAt: string | null;
  cycleEndsAt: string | null;
  pendingPlanName: string | null;
  activeLocations: { usage: number; limit: number | null };
  dashboardUsers: { usage: number; limit: number | null };
  managePlanUrl: string | null;
  canManagePlan: boolean;
  owner: EntitlementMembership | null;
  memberships: EntitlementMembership[];
  reportingLocations: EntitlementLocation[];
  resolutionRequired: boolean;
  userLimitExceeded: boolean;
  locationLimitExceeded: boolean;
  locationSelectionRequired: boolean;
  flashMessage: string | null;
};

type PlanActionData = {
  ok: boolean;
  intent?: string;
  message?: string;
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(date);
}

function formatUsage({
  usage,
  limit,
  singular,
}: {
  usage: number;
  limit: number | null;
  singular: string;
}) {
  if (limit === null)
    return `${usage} ${usage === 1 ? singular : `${singular}s`}`;
  return `${usage} of ${limit} ${usage === 1 ? singular : `${singular}s`}`;
}

const cardStyle = {
  background: "white",
  border: "1px solid #e3e3e3",
  borderRadius: 16,
  padding: 20,
} as const;

const primaryLinkStyle = {
  background: "#2563eb",
  borderRadius: 10,
  color: "white",
  fontWeight: 700,
  padding: "11px 16px",
  textDecoration: "none",
} as const;

export function PlanSetup({ data }: { data: PlanSetupData }) {
  const actionData = useActionData<PlanActionData>();
  const navigation = useNavigation();
  const trialEnd = formatDate(data.trialEndsAt);
  const cycleEnd = formatDate(data.cycleEndsAt);
  const isSubmitting = navigation.state !== "idle";
  const activeMemberships = data.memberships.filter(
    (membership) => membership.status === "active",
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {data.flashMessage ? (
        <div
          role="status"
          style={{
            background: "#eaf7ef",
            border: "1px solid #a8d5b7",
            borderRadius: 10,
            color: "#166534",
            fontWeight: 700,
            padding: "10px 14px",
          }}
        >
          {data.flashMessage}
        </div>
      ) : null}

      {data.resolutionRequired ? (
        <div
          role="alert"
          style={{
            background: "#fff7ed",
            border: "1px solid #fdba74",
            borderRadius: 10,
            color: "#9a3412",
            padding: 14,
          }}
        >
          <strong>Plan limits need attention.</strong> Select the dashboard
          users and reporting locations that should remain active before opening
          reports.
          {!data.canManagePlan ? (
            <div style={{ marginTop: 6 }}>
              The store owner can change the Shopify plan if more capacity is
              needed.
            </div>
          ) : null}
        </div>
      ) : null}

      {actionData?.message && actionData.intent?.startsWith("save-") ? (
        <div
          role={actionData.ok ? "status" : "alert"}
          style={{
            color: actionData.ok ? "#166534" : "#b42318",
            fontWeight: 700,
          }}
        >
          {actionData.message}
        </div>
      ) : null}

      <section style={cardStyle}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            justifyContent: "space-between",
          }}
        >
          <div>
            <p style={{ color: "#616161", margin: "0 0 4px" }}>Current plan</p>
            <h2 style={{ margin: 0 }}>{data.currentPlanName}</h2>
          </div>
          {data.canManagePlan && data.managePlanUrl ? (
            <a href={data.managePlanUrl} style={primaryLinkStyle} target="_top">
              Manage plan
            </a>
          ) : null}
        </div>

        <dl
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            margin: "24px 0 0",
          }}
        >
          <div>
            <dt style={{ color: "#616161", fontWeight: 700 }}>
              Reporting locations
            </dt>
            <dd style={{ margin: "4px 0 0" }}>
              {formatUsage({
                ...data.activeLocations,
                singular: "reporting location",
              })}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#616161", fontWeight: 700 }}>
              Dashboard users
            </dt>
            <dd style={{ margin: "4px 0 0" }}>
              {formatUsage({
                ...data.dashboardUsers,
                singular: "dashboard user",
              })}
            </dd>
          </div>
          <div>
            <dt style={{ color: "#616161", fontWeight: 700 }}>Store owner</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {data.owner?.displayName ?? "Waiting for the Shopify store owner"}
            </dd>
          </div>
          {data.state === "trial" && trialEnd ? (
            <div>
              <dt style={{ color: "#616161", fontWeight: 700 }}>Trial ends</dt>
              <dd style={{ margin: "4px 0 0" }}>{trialEnd}</dd>
            </div>
          ) : null}
          {data.state === "canceling" ? (
            <div>
              <dt style={{ color: "#616161", fontWeight: 700 }}>Plan status</dt>
              <dd style={{ margin: "4px 0 0" }}>
                Cancels at end of cycle{cycleEnd ? ` on ${cycleEnd}` : ""}
              </dd>
            </div>
          ) : null}
          {data.pendingPlanName ? (
            <div>
              <dt style={{ color: "#616161", fontWeight: 700 }}>
                Pending plan change
              </dt>
              <dd style={{ margin: "4px 0 0" }}>{data.pendingPlanName}</dd>
            </div>
          ) : null}
        </dl>

        {(data.userLimitExceeded || data.locationLimitExceeded) &&
        data.canManagePlan &&
        data.managePlanUrl ? (
          <p style={{ margin: "20px 0 0" }}>
            Need to keep everything active?{" "}
            <a href={data.managePlanUrl} target="_top">
              Manage plan
            </a>
            .
          </p>
        ) : null}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Manage reporting locations</h2>
        <p style={{ color: "#616161" }}>
          Shopify locations remain detected and synchronized. Only selected
          reporting locations appear in ShopOps reports; disabling one keeps its
          historical data.
        </p>
        <Form method="post" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="intent" value="save-reporting-locations" />
          {data.reportingLocations.map((location) => (
            <label
              key={location.id}
              style={{ alignItems: "center", display: "flex", gap: 10 }}
            >
              <input
                defaultChecked={
                  location.shopifyIsActive && location.reportingEnabled
                }
                disabled={!location.shopifyIsActive}
                name="location_ids"
                type="checkbox"
                value={location.shopifyLocationId}
              />
              <span>
                {location.name}
                {!location.shopifyIsActive ? " (inactive in Shopify)" : ""}
              </span>
            </label>
          ))}
          {data.reportingLocations.length === 0 ? (
            <p style={{ color: "#616161" }}>
              No Shopify locations detected yet.
            </p>
          ) : null}
          <button disabled={isSubmitting} type="submit">
            {isSubmitting &&
            navigation.formData?.get("intent") === "save-reporting-locations"
              ? "Saving..."
              : "Save reporting locations"}
          </button>
        </Form>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Dashboard access</h2>
        <p style={{ color: "#616161" }}>
          Dashboard users are people who can open ShopOps Studio. The store
          owner counts as one. Shopify administrators do not receive ShopOps
          access automatically. POS sellers and Staff profiles without dashboard
          access do not count.
        </p>
        {data.dashboardUsers.limit !== null &&
        data.dashboardUsers.usage >= data.dashboardUsers.limit ? (
          <p style={{ color: "#9a3412", fontWeight: 700 }}>
            Your plan limit has been reached. Upgrade your plan or remove an
            existing dashboard user&apos;s access.
          </p>
        ) : null}
        {data.userLimitExceeded ? (
          <Form method="post" style={{ display: "grid", gap: 10 }}>
            <input
              type="hidden"
              name="intent"
              value="save-dashboard-memberships"
            />
            {activeMemberships.map((membership) =>
              membership.isOwner ? (
                <div
                  key={membership.id}
                  style={{ alignItems: "center", display: "flex", gap: 10 }}
                >
                  <input
                    name="membership_ids"
                    type="hidden"
                    value={membership.id}
                  />
                  <input checked disabled readOnly type="checkbox" />
                  <span>{membership.displayName} — Owner (always active)</span>
                </div>
              ) : (
                <label
                  key={membership.id}
                  style={{ alignItems: "center", display: "flex", gap: 10 }}
                >
                  <input
                    defaultChecked
                    name="membership_ids"
                    type="checkbox"
                    value={membership.id}
                  />
                  <span>
                    {membership.displayName} — {membership.role}
                  </span>
                </label>
              ),
            )}
            <button disabled={isSubmitting} type="submit">
              {isSubmitting &&
              navigation.formData?.get("intent") ===
                "save-dashboard-memberships"
                ? "Saving..."
                : "Save dashboard access"}
            </button>
          </Form>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {activeMemberships.map((membership) => (
              <div key={membership.id}>
                {membership.displayName} —{" "}
                {membership.isOwner
                  ? "Owner (always active) — Locked"
                  : membership.role}
              </div>
            ))}
          </div>
        )}
        <p style={{ marginBottom: 0 }}>
          Invite, activate, deactivate, and assign locations on the{" "}
          <Link to="/app/admin/staff">Staff page</Link>.
        </p>
      </section>
    </div>
  );
}

import { Link } from "react-router";

import type { EntitlementMembership } from "../../lib/entitlement-model";
import { AppButtonLink } from "../ui/AppButton";
import {
  ContentCard,
  ExternalAction,
  InlineNotice,
  UsageSummary,
} from "../ui/ShopOpsPage";

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
  resolutionRequired: boolean;
  userLimitExceeded: boolean;
  locationLimitExceeded: boolean;
  locationSelectionRequired: boolean;
  flashMessage: string | null;
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(date);
}

export function PlanSetup({ data }: { data: PlanSetupData }) {
  const trialEnd = formatDate(data.trialEndsAt);
  const cycleEnd = formatDate(data.cycleEndsAt);

  return (
    <div>
      {data.flashMessage ? (
        <div style={{ marginBottom: 20 }}>
          <InlineNotice tone="success">{data.flashMessage}</InlineNotice>
        </div>
      ) : null}

      {data.resolutionRequired ? (
        <div style={{ marginBottom: 20 }}>
          <InlineNotice tone="warning">
            <strong>Action required.</strong> Update the affected reporting
            locations or dashboard access before opening reports.
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 10,
              }}
            >
              {data.locationLimitExceeded || data.locationSelectionRequired ? (
                <Link to="/app/locations?tab=reporting">
                  Manage reporting locations
                </Link>
              ) : null}
              {data.userLimitExceeded ? (
                <Link to="/app/people?tab=access">Manage dashboard access</Link>
              ) : null}
            </div>
            {!data.canManagePlan ? (
              <div style={{ marginTop: 6 }}>
                The store owner can change the Shopify plan if more capacity is
                needed.
              </div>
            ) : null}
          </InlineNotice>
        </div>
      ) : null}

      <ContentCard
        title={`Current plan: ${data.currentPlanName}`}
        action={
          data.canManagePlan && data.managePlanUrl ? (
            <ExternalAction href={data.managePlanUrl}>
              Manage plan
            </ExternalAction>
          ) : undefined
        }
      >
        <dl
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            margin: 0,
          }}
        >
          <div>
            <dt style={{ color: "#616161", fontWeight: 700 }}>Status</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {data.state === "canceling"
                ? `Cancels at end of cycle${cycleEnd ? ` on ${cycleEnd}` : ""}`
                : data.state.charAt(0).toUpperCase() + data.state.slice(1)}
            </dd>
          </div>
          {data.state === "trial" && trialEnd ? (
            <div>
              <dt style={{ color: "#616161", fontWeight: 700 }}>Trial ends</dt>
              <dd style={{ margin: "4px 0 0" }}>{trialEnd}</dd>
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
      </ContentCard>

      <div className="shopops-usage-grid">
        <UsageSummary
          action={
            <AppButtonLink
              fullWidth
              to="/app/locations?tab=reporting"
              variant="secondary"
            >
              Manage reporting locations
            </AppButtonLink>
          }
          label="Reporting locations"
          limit={data.activeLocations.limit}
          usage={data.activeLocations.usage}
        />
        <UsageSummary
          action={
            <AppButtonLink
              fullWidth
              to="/app/people?tab=access"
              variant="secondary"
            >
              Manage dashboard access
            </AppButtonLink>
          }
          label="Dashboard users"
          limit={data.dashboardUsers.limit}
          usage={data.dashboardUsers.usage}
        />
      </div>

      <ContentCard title="Dashboard access">
        <p style={{ color: "#616161" }}>
          Dashboard users are people who can open ShopOps Studio. The store
          owner counts as one. Shopify administrators do not receive ShopOps
          access automatically. POS sellers and Staff profiles without dashboard
          access do not count.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>Store owner:</strong>{" "}
          {data.owner
            ? `${data.owner.displayName} — Owner · Active · Always has access · Locked`
            : "Waiting for the Shopify store owner"}
        </p>
      </ContentCard>
    </div>
  );
}

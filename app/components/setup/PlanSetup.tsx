import { Link } from "react-router";

import type { EntitlementMembership } from "../../lib/entitlement-model";
import { formatStoreDate } from "../../lib/dashboard/dashboard-metrics";
import { AppButtonLink } from "../ui/AppButton";
import { StatusBadge } from "../ui/StatusBadge";
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
  return formatStoreDate(value);
}

export function PlanSetup({ data }: { data: PlanSetupData }) {
  const trialEnd = formatDate(data.trialEndsAt);
  const cycleEnd = formatDate(data.cycleEndsAt);
  const subscriptionStatus =
    data.state === "canceling"
      ? "Canceling"
      : data.state === "trial"
        ? "Trial"
        : "Active";
  const subscriptionStatusVariant =
    data.state === "canceling"
      ? ("warning" as const)
      : data.state === "trial"
        ? ("info" as const)
        : ("success" as const);

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
            locations or ShopOps access before opening reports.
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
                <Link to="/app/people?tab=access">Manage ShopOps access</Link>
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
        title="Current plan"
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
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            margin: 0,
          }}
        >
          <div>
            <dt className="shopops-summary-card__label">Plan</dt>
            <dd
              style={{
                fontSize: 22,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 800,
                lineHeight: 1.25,
                margin: "7px 0 0",
              }}
            >
              {data.currentPlanName}
            </dd>
          </div>
          <div>
            <dt className="shopops-summary-card__label">Subscription status</dt>
            <dd style={{ margin: "8px 0 0" }}>
              <StatusBadge variant={subscriptionStatusVariant}>
                {subscriptionStatus}
              </StatusBadge>
              {data.state === "canceling" ? (
                <div className="shopops-helper-text">
                  Cancels at the end of the billing cycle
                  {cycleEnd ? ` on ${cycleEnd}` : ""}.
                </div>
              ) : null}
            </dd>
          </div>
          {data.state === "trial" && trialEnd ? (
            <div>
              <dt className="shopops-summary-card__label">Trial ends</dt>
              <dd
                style={{
                  fontSize: 18,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 750,
                  margin: "7px 0 0",
                }}
              >
                {trialEnd}
              </dd>
            </div>
          ) : null}
          {data.pendingPlanName ? (
            <div>
              <dt className="shopops-summary-card__label">
                Pending plan change
              </dt>
              <dd style={{ fontWeight: 700, margin: "7px 0 0" }}>
                {data.pendingPlanName}
              </dd>
            </div>
          ) : null}
        </dl>
        {!data.canManagePlan ? (
          <p className="shopops-helper-text" style={{ marginBottom: 0 }}>
            ShopOps exposes plan changes only to the store owner. Shopify may
            separately allow staff with billing and app permissions to manage
            app charges in Shopify admin.
          </p>
        ) : null}
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
              Manage ShopOps access
            </AppButtonLink>
          }
          label="ShopOps users"
          limit={data.dashboardUsers.limit}
          usage={data.dashboardUsers.usage}
        />
      </div>

      <ContentCard title="ShopOps access">
        <p style={{ color: "#616161" }}>
          ShopOps users are people who can open ShopOps Studio. The store owner
          counts as one. Shopify administrators do not receive ShopOps access
          automatically. POS sellers and Staff profiles without ShopOps access
          do not count.
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

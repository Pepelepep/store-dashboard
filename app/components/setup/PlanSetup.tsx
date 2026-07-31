export type PlanSetupData = {
  currentPlanName: string;
  state: "active" | "trial" | "canceling";
  trialEndsAt: string | null;
  cycleEndsAt: string | null;
  pendingPlanName: string | null;
  activeLocations: {
    usage: number;
    limit: number | null;
  };
  dashboardUsers: {
    usage: number;
    limit: number | null;
  };
  managePlanUrl: string;
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
  }).format(date);
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
  const label = usage === 1 ? singular : `${singular}s`;
  return limit === null
    ? `Unlimited ${singular}s`
    : `${usage} of ${limit} ${label}`;
}

export function PlanSetup({ data }: { data: PlanSetupData }) {
  const trialEnd = formatDate(data.trialEndsAt);
  const cycleEnd = formatDate(data.cycleEndsAt);

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 16,
        padding: 20,
      }}
    >
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
        <a
          href={data.managePlanUrl}
          style={{
            background: "#2563eb",
            borderRadius: 10,
            color: "white",
            fontWeight: 700,
            padding: "11px 16px",
            textDecoration: "none",
          }}
          target="_top"
        >
          Manage plan
        </a>
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
            Active locations
          </dt>
          <dd style={{ margin: "4px 0 0" }}>
            {formatUsage({
              ...data.activeLocations,
              singular: "active location",
            })}
          </dd>
        </div>
        <div>
          <dt style={{ color: "#616161", fontWeight: 700 }}>Dashboard users</dt>
          <dd style={{ margin: "4px 0 0" }}>
            {formatUsage({
              ...data.dashboardUsers,
              singular: "dashboard user",
            })}
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
      {data.activeLocations.limit === 10 ? (
        <p style={{ color: "#616161", margin: "20px 0 0" }}>
          Need more than 10 active locations?{" "}
          <a href="/support">Contact support</a>.
        </p>
      ) : null}
    </section>
  );
}

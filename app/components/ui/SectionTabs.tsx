import { Link, useLocation } from "react-router";

export type SectionTab<T extends string> = {
  value: T;
  label: string;
};

export function SectionTabs<T extends string>({
  activeTab,
  ariaLabel,
  tabs,
}: {
  activeTab: T;
  ariaLabel: string;
  tabs: Array<SectionTab<T>>;
}) {
  const location = useLocation();

  return (
    <nav
      aria-label={ariaLabel}
      className="shopops-section-tabs"
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 24,
        overflowX: "auto",
        paddingBottom: 2,
        scrollbarWidth: "thin",
        whiteSpace: "nowrap",
      }}
    >
      {tabs.map((tab) => {
        const searchParams = new URLSearchParams(location.search);
        searchParams.set("tab", tab.value);
        const to = `${location.pathname}?${searchParams.toString()}`;
        const isActive = activeTab === tab.value;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            key={tab.value}
            to={to}
            style={{
              background: isActive ? "#eaf2ff" : "white",
              border: isActive ? "2px solid #2563eb" : "1px solid #c9cccf",
              borderRadius: 10,
              color: isActive ? "#174ea6" : "#374151",
              flex: "0 0 auto",
              fontWeight: 800,
              padding: "10px 16px",
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

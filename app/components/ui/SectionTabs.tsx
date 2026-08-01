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
    <nav aria-label={ariaLabel} className="shopops-section-tabs">
      {tabs.map((tab) => {
        const searchParams = new URLSearchParams(location.search);
        searchParams.set("tab", tab.value);
        const to = `${location.pathname}?${searchParams.toString()}`;
        const isActive = activeTab === tab.value;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="shopops-section-tabs__item"
            key={tab.value}
            to={to}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

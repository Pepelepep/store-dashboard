import type { CSSProperties, ReactNode } from "react";

import { AppButtonLink } from "./AppButton";

type PageNoticeTone = "neutral" | "info" | "success" | "warning" | "critical";

const toneStyles: Record<
  PageNoticeTone,
  {
    border: string;
    background: string;
    accent: string;
    title: string;
  }
> = {
  neutral: {
    border: "#e3e3e3",
    background: "white",
    accent: "#616161",
    title: "#202223",
  },
  info: {
    border: "#b2ddff",
    background: "#eff8ff",
    accent: "#175cd3",
    title: "#1849a9",
  },
  success: {
    border: "#abefc6",
    background: "#ecfdf3",
    accent: "#067647",
    title: "#075e45",
  },
  warning: {
    border: "#f1c96b",
    background: "#fff8e5",
    accent: "#7a4b00",
    title: "#5c3a00",
  },
  critical: {
    border: "#fecdca",
    background: "#fef3f2",
    accent: "#b42318",
    title: "#912018",
  },
};

export function PageNotice({
  title,
  message,
  bullets,
  cta,
  tone = "neutral",
  children,
  style,
}: {
  title: string;
  message: ReactNode;
  bullets?: string[];
  cta?: {
    to: string;
    label: string;
  };
  tone?: PageNoticeTone;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const colors = toneStyles[tone];

  return (
    <section
      style={{
        background: colors.background,
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        marginBottom: 20,
        padding: 18,
        ...style,
      }}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <div
            style={{
              color: colors.accent,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0,
              marginBottom: 4,
              textTransform: "uppercase",
            }}
          >
            ShopOps Studio
          </div>
          <h2
            style={{
              color: colors.title,
              fontSize: 22,
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {title}
          </h2>
          <div
            style={{
              color: "#4b5563",
              fontSize: 14,
              lineHeight: 1.5,
              marginTop: 6,
              maxWidth: 860,
            }}
          >
            {message}
          </div>
        </div>

        {bullets?.length ? (
          <ul
            style={{
              color: "#374151",
              display: "grid",
              gap: 6,
              lineHeight: 1.45,
              margin: 0,
              paddingLeft: 20,
            }}
          >
            {bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}

        {children}

        {cta ? (
          <div>
            <AppButtonLink to={cta.to} variant="primary">
              {cta.label}
            </AppButtonLink>
          </div>
        ) : null}
      </div>
    </section>
  );
}

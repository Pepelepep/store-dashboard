import type { CSSProperties, ReactNode } from "react";

type StatusBadgeVariant = "success" | "error" | "warning" | "info" | "neutral";

const badgeStyles: Record<
  StatusBadgeVariant,
  {
    color: string;
    background: string;
    border: string;
  }
> = {
  success: {
    color: "#067647",
    background: "#ecfdf3",
    border: "#abefc6",
  },
  error: {
    color: "#b42318",
    background: "#fef3f2",
    border: "#fecdca",
  },
  warning: {
    color: "#7a4b00",
    background: "#fff8e5",
    border: "#f1c96b",
  },
  info: {
    color: "#175cd3",
    background: "#eff8ff",
    border: "#b2ddff",
  },
  neutral: {
    color: "#616161",
    background: "#f6f6f7",
    border: "#e3e3e3",
  },
};

export function StatusBadge({
  variant,
  children,
  style,
}: {
  variant: StatusBadgeVariant;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const colors = badgeStyles[variant];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.25,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

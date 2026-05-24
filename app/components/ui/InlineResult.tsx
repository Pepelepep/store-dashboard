import type { CSSProperties, ReactNode } from "react";

type InlineResultVariant = "success" | "error" | "info";

const resultStyles: Record<
  InlineResultVariant,
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
  info: {
    color: "#175cd3",
    background: "#eff8ff",
    border: "#b2ddff",
  },
};

export function InlineResult({
  variant,
  children,
  style,
}: {
  variant: InlineResultVariant;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const colors = resultStyles[variant];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${colors.border}`,
        background: colors.background,
        color: colors.color,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1.35,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

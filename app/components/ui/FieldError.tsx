import type { CSSProperties, ReactNode } from "react";

export function FieldError({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  if (!children) return null;

  return (
    <span
      style={{
        color: "#b42318",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

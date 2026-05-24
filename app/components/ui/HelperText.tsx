import type { CSSProperties, ReactNode } from "react";

export function HelperText({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        color: "#616161",
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

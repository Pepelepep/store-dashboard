import { useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

type AppButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type AppButtonProps = {
  variant?: AppButtonVariant;
  children: ReactNode;
  compact?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "disabled" | "onClick"
>;

type AppButtonLinkProps = {
  to: string;
  variant?: AppButtonVariant;
  children: ReactNode;
  compact?: boolean;
  fullWidth?: boolean;
  style?: CSSProperties;
};

const buttonBaseStyle: CSSProperties = {
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 700,
  transition:
    "background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 80ms ease",
};

const buttonVariants: Record<
  AppButtonVariant,
  {
    border: string;
    background: string;
    color: string;
    hoverBackground: string;
    hoverBorder: string;
    activeBackground: string;
    disabledBackground: string;
    disabledBorder: string;
    disabledColor: string;
  }
> = {
  primary: {
    border: "#2563eb",
    background: "#2563eb",
    color: "white",
    hoverBackground: "#1d4ed8",
    hoverBorder: "#1d4ed8",
    activeBackground: "#1e40af",
    disabledBackground: "#93c5fd",
    disabledBorder: "#93c5fd",
    disabledColor: "white",
  },
  secondary: {
    border: "#c9cccf",
    background: "white",
    color: "#202223",
    hoverBackground: "#f6f6f7",
    hoverBorder: "#8a8f93",
    activeBackground: "#eceff1",
    disabledBackground: "white",
    disabledBorder: "#dde0e4",
    disabledColor: "#8a8f93",
  },
  danger: {
    border: "#c9cccf",
    background: "white",
    color: "#b42318",
    hoverBackground: "#fff4f4",
    hoverBorder: "#d92d20",
    activeBackground: "#fee4e2",
    disabledBackground: "white",
    disabledBorder: "#dde0e4",
    disabledColor: "#8a8f93",
  },
  ghost: {
    border: "transparent",
    background: "transparent",
    color: "#202223",
    hoverBackground: "#f6f6f7",
    hoverBorder: "transparent",
    activeBackground: "#eceff1",
    disabledBackground: "transparent",
    disabledBorder: "transparent",
    disabledColor: "#8a8f93",
  },
};

export function AppButton({
  variant = "primary",
  type = "button",
  disabled = false,
  compact = false,
  fullWidth = false,
  children,
  onClick,
  style,
}: AppButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const colors = buttonVariants[variant];
  const background = disabled
    ? colors.disabledBackground
    : isActive
      ? colors.activeBackground
      : isHovered
        ? colors.hoverBackground
        : colors.background;
  const borderColor = disabled
    ? colors.disabledBorder
    : isHovered || isActive
      ? colors.hoverBorder
      : colors.border;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsActive(false);
      }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      style={{
        ...buttonBaseStyle,
        width: fullWidth ? "100%" : undefined,
        border: `1px solid ${borderColor}`,
        background,
        color: disabled ? colors.disabledColor : colors.color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.72 : 1,
        padding: compact ? "6px 10px" : buttonBaseStyle.padding,
        borderRadius: compact ? 8 : buttonBaseStyle.borderRadius,
        transform: isActive && !disabled ? "translateY(1px)" : "translateY(0)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function AppButtonLink({
  to,
  variant = "secondary",
  compact = false,
  fullWidth = false,
  children,
  style,
}: AppButtonLinkProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const colors = buttonVariants[variant];
  const background = isActive
    ? colors.activeBackground
    : isHovered
      ? colors.hoverBackground
      : colors.background;
  const borderColor = isHovered || isActive ? colors.hoverBorder : colors.border;

  return (
    <Link
      to={to}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsActive(false);
      }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      style={{
        ...buttonBaseStyle,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: fullWidth ? "100%" : undefined,
        border: `1px solid ${borderColor}`,
        background,
        color: colors.color,
        cursor: "pointer",
        padding: compact ? "6px 10px" : buttonBaseStyle.padding,
        borderRadius: compact ? 8 : buttonBaseStyle.borderRadius,
        transform: isActive ? "translateY(1px)" : "translateY(0)",
        textDecoration: "none",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </Link>
  );
}

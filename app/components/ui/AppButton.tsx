import { useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

type AppButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type AppButtonProps = {
  variant?: AppButtonVariant;
  children: ReactNode;
  compact?: boolean;
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "disabled" | "onClick" | "name" | "value"
>;

type AppButtonLinkProps = {
  to: string;
  reloadDocument?: boolean;
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
    disabledBackground: "#e5e7eb",
    disabledBorder: "#d1d5db",
    disabledColor: "#6b7280",
  },
  secondary: {
    border: "#c9cccf",
    background: "white",
    color: "#202223",
    hoverBackground: "#f6f6f7",
    hoverBorder: "#8a8f93",
    activeBackground: "#eceff1",
    disabledBackground: "#f3f4f6",
    disabledBorder: "#d1d5db",
    disabledColor: "#9ca3af",
  },
  danger: {
    border: "#c9cccf",
    background: "white",
    color: "#b42318",
    hoverBackground: "#fff4f4",
    hoverBorder: "#d92d20",
    activeBackground: "#fee4e2",
    disabledBackground: "#f3f4f6",
    disabledBorder: "#d1d5db",
    disabledColor: "#9ca3af",
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
  className,
  children,
  onClick,
  name,
  value,
  style,
}: AppButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isFocusVisible, setIsFocusVisible] = useState(false);
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
      className={className}
      type={type}
      disabled={disabled}
      name={name}
      value={value}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsActive(false);
      }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      onFocus={(event) =>
        setIsFocusVisible(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setIsFocusVisible(false)}
      style={{
        ...buttonBaseStyle,
        width: fullWidth ? "100%" : undefined,
        border: `1px solid ${borderColor}`,
        background,
        color: disabled ? colors.disabledColor : colors.color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: 1,
        padding: compact ? "6px 10px" : buttonBaseStyle.padding,
        borderRadius: compact ? 8 : buttonBaseStyle.borderRadius,
        transform: isActive && !disabled ? "translateY(1px)" : "translateY(0)",
        outline: isFocusVisible ? "3px solid #93c5fd" : "none",
        outlineOffset: isFocusVisible ? 2 : undefined,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function AppButtonLink({
  to,
  reloadDocument = false,
  variant = "secondary",
  compact = false,
  fullWidth = false,
  children,
  style,
}: AppButtonLinkProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [isFocusVisible, setIsFocusVisible] = useState(false);
  const colors = buttonVariants[variant];
  const background = isActive
    ? colors.activeBackground
    : isHovered
      ? colors.hoverBackground
      : colors.background;
  const borderColor =
    isHovered || isActive ? colors.hoverBorder : colors.border;

  return (
    <Link
      to={to}
      reloadDocument={reloadDocument}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsActive(false);
      }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
      onFocus={(event) =>
        setIsFocusVisible(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setIsFocusVisible(false)}
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
        outline: isFocusVisible ? "3px solid #93c5fd" : "none",
        outlineOffset: isFocusVisible ? 2 : undefined,
        textDecoration: "none",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </Link>
  );
}

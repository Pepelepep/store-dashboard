import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "../../lib/utils";
import { Button, buttonVariants } from "./primitives/button";

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
  className?: string;
  style?: CSSProperties;
};

const primitiveVariant = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  ghost: "ghost",
} as const;

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
  return (
    <Button
      className={cn(fullWidth && "w-full", className)}
      disabled={disabled}
      name={name}
      onClick={onClick}
      size={compact ? "sm" : "default"}
      style={style}
      type={type}
      value={value}
      variant={primitiveVariant[variant]}
    >
      {children}
    </Button>
  );
}

export function AppButtonLink({
  to,
  reloadDocument = false,
  variant = "secondary",
  compact = false,
  fullWidth = false,
  className,
  children,
  style,
}: AppButtonLinkProps) {
  return (
    <Link
      className={cn(
        buttonVariants({
          variant: primitiveVariant[variant],
          size: compact ? "sm" : "default",
        }),
        fullWidth && "w-full",
        className,
      )}
      reloadDocument={reloadDocument}
      style={style}
      to={to}
    >
      {children}
    </Link>
  );
}

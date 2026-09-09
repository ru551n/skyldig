import { forwardRef } from "react";
import { Link } from "react-router";

import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-pine text-paper hover:bg-pine/90",
  secondary: "bg-paper text-pine border border-line hover:bg-frost",
  ghost: "bg-transparent text-pine hover:bg-frost",
  danger: "bg-rust text-paper hover:bg-rust/90",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-body",
  lg: "min-h-12 px-6 text-lead",
};

export interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
      />
    </svg>
  );
}

export type ButtonProps = ButtonOwnProps &
  React.ButtonHTMLAttributes<HTMLButtonElement>;

/** A native `<button>` styled per the design system. For navigation, use `ButtonLink`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export type ButtonLinkProps = ButtonOwnProps &
  React.ComponentProps<typeof Link>;

/** A React Router `<Link>` styled identically to `Button`, for navigation-shaped actions. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", loading = false, fullWidth = false, className, children, ...rest },
  ref,
) {
  return (
    <Link
      ref={ref}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </Link>
  );
});

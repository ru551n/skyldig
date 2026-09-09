import { cn } from "./cn.ts";

export type PillVariant = "neutral" | "warning";

export interface PillProps {
  variant?: PillVariant;
  children: React.ReactNode;
  className?: string;
}

const variants: Record<PillVariant, string> = {
  neutral: "bg-frost text-pine-soft",
  warning: "bg-sol/40 text-pine",
};

/** A small rounded label, e.g. "Går ut 8 dec". */
export function Pill({ variant = "neutral", children, className }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-3 py-1 text-meta font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

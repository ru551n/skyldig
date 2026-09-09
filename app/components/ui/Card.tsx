import { cn } from "./cn.ts";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sol tint, used for settle-up rows and other highlighted cards. */
  tinted?: boolean;
}

export function Card({ tinted = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-line p-4",
        tinted ? "border-sol/40 bg-sol/20" : "bg-paper",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Omit the bottom divider, e.g. for the last row in a list. */
  noDivider?: boolean;
}

/** A list row with a 1px `line` divider, per the activity list in docs/design.md. */
export function Row({ noDivider = false, className, children, ...rest }: RowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3",
        !noDivider && "border-b border-line last:border-b-0",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

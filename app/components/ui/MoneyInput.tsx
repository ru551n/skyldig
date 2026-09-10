import { forwardRef } from "react";

import { cn } from "./cn.ts";

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  invalid?: boolean;
  currency: string;
}

/** Decimal amount input with the currency code shown inside the control. */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { invalid, currency, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        "rounded-control bg-paper flex min-h-11 items-center border pr-3",
        // The ring goes around the whole control, currency label included, not the inner input.
        "has-[:focus-visible]:outline-pine has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
        invalid ? "border-rust" : "border-line",
        className,
      )}
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className="tabular rounded-control text-body text-pine placeholder:text-pine-soft min-w-0 flex-1 bg-transparent px-3 py-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        {...rest}
      />
      <span className="text-meta text-pine-soft font-medium">{currency}</span>
    </div>
  );
});

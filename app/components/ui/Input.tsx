import { forwardRef } from "react";

import { cn } from "./cn.ts";

export interface InvalidProp {
  invalid?: boolean;
}

const controlBase =
  "w-full min-h-11 rounded-control border bg-paper px-3 py-2 text-body text-pine placeholder:text-pine-soft " +
  "disabled:cursor-not-allowed disabled:opacity-60";

function borderClass(invalid: boolean | undefined) {
  return invalid ? "border-rust" : "border-line";
}

export type InputProps = InvalidProp & React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, borderClass(invalid), className)}
      {...rest}
    />
  );
});

export type TextareaProps = InvalidProp & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, "min-h-24 resize-y", borderClass(invalid), className)}
      {...rest}
    />
  );
});

export type SelectProps = InvalidProp & React.SelectHTMLAttributes<HTMLSelectElement>;

/** Native `<select>`, styled to match the other controls. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, borderClass(invalid), "appearance-none pr-8", className)}
      {...rest}
    >
      {children}
    </select>
  );
});

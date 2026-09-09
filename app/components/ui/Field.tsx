import { cn } from "./cn.ts";

export interface FieldIds {
  /** Pass as `id` on the control. */
  id: string;
  /** Pass as `aria-describedby` on the control (undefined when there is no hint/error). */
  "aria-describedby": string | undefined;
  /** Pass as `invalid` on the control (Input/Textarea/Select all accept this). */
  invalid: boolean;
}

export interface FieldProps {
  /** Used to derive `htmlFor`/`id` — must be unique on the page. */
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string;
  /**
   * Render-prop that receives the wiring for the control: `id`,
   * `aria-describedby`, and `invalid`. Spread these onto the control, e.g.
   *
   * ```tsx
   * <Field htmlFor="amount" label="Belopp" error={err}>
   *   {(ids) => <Input {...ids} name="amount" />}
   * </Field>
   * ```
   */
  children: (ids: FieldIds) => React.ReactNode;
  className?: string;
}

/**
 * Label + control + hint/error, wired for accessibility. Use the render-prop
 * form to pass `id`/`aria-describedby`/`invalid` down to the control.
 */
export function Field({ htmlFor, label, hint, error, children, className }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-body text-pine font-medium">
        {label}
      </label>
      {children({ id: htmlFor, "aria-describedby": describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-meta text-pine-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-meta text-rust font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

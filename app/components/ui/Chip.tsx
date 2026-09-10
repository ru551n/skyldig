import { cn } from "./cn.ts";

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/**
 * A toggle chip, e.g. for participant selection. The state reads from shape as well as colour:
 * pressed is solid pine with a check, unpressed is white with a dashed edge and an empty circle
 * in the check's place, so chips keep their width when toggled and don't reflow the row.
 * Sizes are written in explicit pixels because this theme redefines the spacing scale
 * (`--spacing-4` is 4px, not Tailwind's 16px; see app/app.css).
 */
export function Chip({ pressed, onPressedChange, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "rounded-chip text-body inline-flex min-h-11 items-center gap-[8px] border px-[14px] font-medium transition-colors",
        pressed
          ? "border-pine bg-pine text-paper hover:bg-pine/90"
          : "border-pine-soft/50 bg-paper text-pine hover:bg-frost border-dashed",
        className,
      )}
      {...rest}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" className="shrink-0">
        {pressed ? (
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
        )}
      </svg>
      {children}
    </button>
  );
}

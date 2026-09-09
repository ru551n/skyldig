import { cn } from "./cn.ts";

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/** A toggle chip, e.g. for participant selection. 44px min touch height, sol tint when pressed. */
export function Chip({ pressed, onPressedChange, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "rounded-chip text-body inline-flex min-h-11 items-center border px-4 font-medium transition-colors",
        pressed ? "border-sol bg-sol text-pine" : "border-line bg-paper text-pine hover:bg-frost",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

import { cn } from "./cn.ts";

export interface AvatarProps {
  name: string;
  /** Determines the background color: pine/sol/moss/rust rotation by `position % 4`. */
  position: number;
  className?: string;
}

const rotation = ["bg-pine text-paper", "bg-sol text-pine", "bg-moss text-paper", "bg-rust text-paper"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Initials avatar. `aria-hidden` — always render the visible name next to it,
 * as this component provides no accessible name of its own.
 */
export function Avatar({ name, position, className }: AvatarProps) {
  const colorClass = rotation[((position % rotation.length) + rotation.length) % rotation.length];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-meta font-semibold",
        colorClass,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

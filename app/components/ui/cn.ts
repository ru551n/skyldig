/** Joins class name fragments, dropping falsy values. Not a full clsx/tailwind-merge — just enough for this design system. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

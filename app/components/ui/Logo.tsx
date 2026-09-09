export interface LogoProps {
  /** Width and height in px. Square viewBox, so this sets both. */
  size?: number;
  className?: string;
  /**
   * Accessible name for standalone use (e.g. the mark alone as a link to `/`).
   * Omit when the mark sits beside visible text that already names it — the
   * default is `aria-hidden` so it doesn't double up the announcement.
   */
  title?: string;
}

/**
 * The Skyldig mark: a settle-up arrow inside a ring, standing for a tangle of
 * debts resolving into one clean payment. Single stroke weight, no fills
 * beyond the stroke itself, `currentColor` throughout so it follows text
 * color on pine, frost and paper alike. Reads clearly down to a 20px favicon.
 */
export function Logo({ size = 24, className, title }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="3.5" />
      <path d="M11.5 20.5L20.5 11.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M13.5 11.5H20.5V18.5"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

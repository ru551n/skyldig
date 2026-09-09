export interface ArrowProps {
  className?: string;
}

/** Inline arrow used between the two names in a settle-up row. */
export function Arrow({ className }: ArrowProps) {
  return (
    <svg
      viewBox="0 0 64 16"
      className={className}
      width="64"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <line x1="0" y1="8" x2="54" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M48 2l8 6-8 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

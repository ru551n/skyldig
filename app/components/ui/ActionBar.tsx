import { cn } from "./cn.ts";

export interface ActionBarProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Mobile: fixed bottom bar with safe-area padding. Desktop (≥880px): a static
 * row, meant to sit under the page title. Children are `Button`/`ButtonLink`.
 */
export function ActionBar({ children, className }: ActionBarProps) {
  return (
    <>
      {/* Reserves the space the fixed bar occupies so it never covers page content. */}
      <div aria-hidden className="h-24 min-[880px]:hidden" />
      <div
        className={cn(
          "border-line bg-paper fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t p-4",
          // Three buttons share one row on a phone, so they get less side padding than a
          // standalone button and never wrap their label.
          "*:px-2 *:whitespace-nowrap max-[359px]:px-3 max-[359px]:*:text-meta",
          "[padding-bottom:calc(1rem+env(safe-area-inset-bottom))]",
          "min-[880px]:static min-[880px]:border-none min-[880px]:bg-transparent min-[880px]:p-0",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";

import { useT } from "~/i18n";

type IconName = "overview" | "expense" | "payment" | "participants";

const ICONS: Record<IconName, React.ReactNode> = {
  overview: <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  expense: (
    <>
      <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
      <path d="M12 8v6M9 11h6" />
    </>
  ),
  payment: (
    <>
      <path d="M4 8.5h14.5M15 5l3.5 3.5L15 12" />
      <path d="M20 15.5H5.5M9 12l-3.5 3.5L9 19" />
    </>
  ),
  participants: (
    <>
      <circle cx="9" cy="9" r="3.25" />
      <path d="M3.5 19.5c.6-3 2.8-4.75 5.5-4.75s4.9 1.75 5.5 4.75" />
      <path d="M15.5 6.1a3.25 3.25 0 0 1 0 6.3M17.5 14.9c1.6.6 2.7 2.3 3 4.6" />
    </>
  ),
};

/**
 * True while the on-screen keyboard is up: a text field has focus *and* the visual viewport has
 * shrunk well below the layout viewport, which is what the keyboard does on iOS Safari and on
 * current Android Chrome. Focus alone is not enough — the expense form focuses its first field on
 * load without a keyboard appearing — and a shrunk viewport alone could just be pinch-zoom.
 * A fixed bottom bar would otherwise ride up over the very field being typed into.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const isTextField = (el: Element | null) =>
      el instanceof HTMLElement &&
      el.matches(
        "textarea, [contenteditable='true'], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=hidden])",
      );
    const update = () =>
      setOpen(isTextField(document.activeElement) && viewport.height < window.innerHeight * 0.75);
    // On focusout, activeElement is still the field losing focus; read it after the move.
    const deferredUpdate = () => setTimeout(update, 0);
    viewport.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", deferredUpdate);
    return () => {
      viewport.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", deferredUpdate);
    };
  }, []);
  return open;
}

export interface TabBarProps {
  sessionPublicId: string;
}

/**
 * The phone's bottom navigation: Översikt plus the three things people do most. A highlight
 * slides to whichever tab matches the current page (instant when the user prefers reduced motion,
 * via the root MotionConfig); pages with no tab of their own, such as Aktivitet, show none.
 * Hidden at 880px and up, where the side rail takes over.
 */
export function TabBar({ sessionPublicId }: TabBarProps) {
  const t = useT();
  const keyboardOpen = useKeyboardOpen();
  const base = `/s/${sessionPublicId}`;
  const tabs: { to: string; label: string; icon: IconName; end?: boolean }[] = [
    { to: base, label: t("dashboard.nav.overview"), icon: "overview", end: true },
    { to: `${base}/utgifter/ny`, label: t("dashboard.actions.newExpense"), icon: "expense" },
    { to: `${base}/betalningar/ny`, label: t("dashboard.actions.newPayment"), icon: "payment" },
    { to: `${base}/deltagare`, label: t("dashboard.actions.participants"), icon: "participants" },
  ];

  return (
    <>
      {/* Reserves the space the fixed bar occupies so it never covers the end of a page. */}
      <div aria-hidden className="h-[calc(4.5rem+env(safe-area-inset-bottom))] min-[880px]:hidden" />
      <nav
        aria-label={t("dashboard.tabsLabel")}
        hidden={keyboardOpen}
        className="border-line bg-paper fixed inset-x-0 bottom-0 z-30 border-t px-2 pt-1 [padding-bottom:calc(0.25rem+env(safe-area-inset-bottom))] min-[880px]:hidden"
      >
        <ul className="mx-auto flex max-w-[480px]">
          {tabs.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `focus-visible:outline-pine relative isolate flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-control px-1 text-[12px] leading-tight font-medium whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                    isActive ? "text-pine" : "text-pine-soft hover:text-pine"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="tab-highlight"
                        aria-hidden
                        className="bg-sol/40 absolute inset-x-1 inset-y-1 -z-10 rounded-control"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <svg
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={isActive ? 2 : 1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {ICONS[tab.icon]}
                    </svg>
                    {tab.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

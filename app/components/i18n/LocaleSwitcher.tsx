import { useLocation } from "react-router";

import { useLocale, useT } from "~/i18n";

export interface LocaleSwitcherProps {
  className?: string;
  /** `sm` shrinks the flag buttons to fit the phone group header beside its other controls. */
  size?: "md" | "sm";
}

const OPTIONS = [
  { locale: "sv", flag: "🇸🇪" },
  { locale: "en", flag: "🇬🇧" },
] as const;

/**
 * Language switcher: two flag buttons, each with a real accessible name via `aria-label`
 * (never a flag standing alone with no name — flags aren't reliably announced by their
 * country as text, and are ambiguous for colorblind/low-vision users). Posts to `/lang` to
 * set the `skyldig_lang` cookie and reload the current page in the chosen language. Each
 * option is a native submit button (`name="locale" value="sv"|"en"`), so this works with
 * JavaScript disabled with no separate fallback needed.
 */
export function LocaleSwitcher({ className, size = "md" }: LocaleSwitcherProps) {
  const location = useLocation();
  const locale = useLocale();
  const t = useT();
  const redirectTo = `${location.pathname}${location.search}`;

  return (
    <form method="post" action="/lang" className={className}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <div
        role="group"
        aria-label={t("common.languageLabel")}
        className="border-line bg-paper inline-flex items-center gap-1 rounded-full border p-1"
      >
        {OPTIONS.map((option) => {
          const active = locale === option.locale;
          const label = t(option.locale === "sv" ? "common.languageSwedish" : "common.languageEnglish");
          return (
            <button
              key={option.locale}
              type="submit"
              name="locale"
              value={option.locale}
              aria-label={label}
              aria-pressed={active}
              title={label}
              className={`focus-visible:outline-pine flex ${size === "sm" ? "h-[32px] w-[32px] text-base" : "h-9 w-9 text-lg"} items-center justify-center rounded-full leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                active ? "bg-sol/40 ring-pine/20 ring-1" : "opacity-60 hover:opacity-100"
              }`}
            >
              <span aria-hidden="true">{option.flag}</span>
            </button>
          );
        })}
      </div>
    </form>
  );
}

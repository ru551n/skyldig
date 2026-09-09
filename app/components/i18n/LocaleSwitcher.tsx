import { useLocation } from "react-router";

import { useLocale, useT } from "~/i18n";

export interface LocaleSwitcherProps {
  className?: string;
}

/**
 * Language switcher: a labeled `<select>` (an accessible name, not just a flag icon) that
 * posts to `/lang` to set the `skyldig_lang` cookie and reload the current page in the chosen
 * language. Works with JavaScript disabled via the submit button; with it, choosing an option
 * submits the form immediately.
 */
export function LocaleSwitcher({ className }: LocaleSwitcherProps) {
  const location = useLocation();
  const locale = useLocale();
  const t = useT();
  const redirectTo = `${location.pathname}${location.search}`;

  return (
    <form method="post" action="/lang" className={className}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <label htmlFor="locale-switcher" className="sr-only">
        {t("common.languageLabel")}
      </label>
      <div className="flex items-center gap-2">
        <select
          id="locale-switcher"
          name="locale"
          defaultValue={locale}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="rounded-control border-line bg-paper text-meta text-pine-soft focus-visible:outline-pine min-h-9 border px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="sv">{t("common.languageSwedish")}</option>
          <option value="en">{t("common.languageEnglish")}</option>
        </select>
        <noscript>
          <button
            type="submit"
            className="rounded-control border-line bg-paper text-meta text-pine-soft min-h-9 border px-3 py-1"
          >
            {t("common.save")}
          </button>
        </noscript>
      </div>
    </form>
  );
}

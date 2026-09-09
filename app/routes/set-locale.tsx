import { redirect } from "react-router";

import { buildLangCookie } from "@server/modules/i18n/locale-cookie.ts";
import { resolveRedirectTarget } from "@server/modules/i18n/redirect-target.ts";

import { isLocale } from "~/i18n/index.ts";
import { getConfig, mutationGuard } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/set-locale";

/**
 * Sets the `skyldig_lang` cookie from the language switcher (see `LocaleSwitcher.tsx`) and
 * redirects back to wherever the form was submitted from. No UI of its own.
 */
export async function action({ request }: Route.ActionArgs) {
  mutationGuard(request);
  const formData = await request.formData();
  const locale = formData.get("locale");
  const redirectTo = formData.get("redirectTo");

  const config = getConfig();
  const headers = new Headers();
  if (typeof locale === "string" && isLocale(locale)) {
    headers.append("Set-Cookie", buildLangCookie(locale, config.cookieSecure));
  }

  const target = resolveRedirectTarget(redirectTo, config);

  return redirect(target, { headers });
}

export default function SetLocale() {
  return null;
}

import type { MetaDescriptor } from "react-router";

import { localeFromMatches, t, type MessageKey } from "~/i18n";

type Matches = readonly ({ loaderData?: unknown } | undefined)[];

/** The public address the site is served from, exposed by the root loader. */
function originFromMatches(matches: Matches): string {
  const root = matches[0]?.loaderData as { publicOrigin?: unknown } | undefined;
  return typeof root?.publicOrigin === "string" ? root.publicOrigin : "";
}

/** The canonical public URL of `path` in the language being rendered. */
export function publicUrl(matches: Matches, path: string): string {
  const base = `${originFromMatches(matches)}${path}`;
  return localeFromMatches(matches) === "en" ? `${base}?lang=en` : base;
}

/**
 * Title, description, canonical URL, language alternates and share previews for a public page.
 * Each language has its own URL (`?lang=en`; Swedish is the default), since both are served at
 * the same path and a crawler sends neither the language cookie nor a useful Accept-Language.
 */
export function seoMeta(
  matches: Matches,
  { path, titleKey, descriptionKey }: { path: string; titleKey: MessageKey; descriptionKey: MessageKey },
): MetaDescriptor[] {
  const locale = localeFromMatches(matches);
  const origin = originFromMatches(matches);
  const svUrl = `${origin}${path}`;
  const enUrl = `${origin}${path}?lang=en`;
  const url = publicUrl(matches, path);
  const title = t(locale, titleKey);
  const description = t(locale, descriptionKey);
  const image = `${origin}/og-image${locale === "en" ? "-en" : ""}.png`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { tagName: "link", rel: "alternate", hrefLang: "sv", href: svUrl },
    { tagName: "link", rel: "alternate", hrefLang: "en", href: enUrl },
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: svUrl },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Skyldig" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: t(locale, "seo.imageAlt") },
    { property: "og:locale", content: locale === "en" ? "en_GB" : "sv_SE" },
    { property: "og:locale:alternate", content: locale === "en" ? "sv_SE" : "en_GB" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

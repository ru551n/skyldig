import { getConfig } from "~/lib/session-context.server.ts";

/** The public pages. Everything else belongs to a group or a browser and is never listed. */
const PAGES = ["/", "/guide", "/new", "/join"];

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/**
 * sitemap.xml: each public page in Swedish (the default URL) and English (`?lang=en`), each entry
 * naming both language versions so search engines serve the right one.
 */
export function loader() {
  const origin = getConfig().publicOrigin;
  const entries = PAGES.flatMap((path) => {
    const sv = escapeXml(`${origin}${path}`);
    const en = escapeXml(`${origin}${path}?lang=en`);
    const alternates = [
      `<xhtml:link rel="alternate" hreflang="sv" href="${sv}"/>`,
      `<xhtml:link rel="alternate" hreflang="en" href="${en}"/>`,
      `<xhtml:link rel="alternate" hreflang="x-default" href="${sv}"/>`,
    ].join("");
    return [sv, en].map((loc) => `  <url><loc>${loc}</loc>${alternates}</url>`);
  });
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

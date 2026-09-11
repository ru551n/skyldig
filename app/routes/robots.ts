import { getConfig } from "~/lib/session-context.server.ts";

/**
 * robots.txt: index the public pages; keep out everything that belongs to a group or a browser.
 * The server also sends `X-Robots-Tag: noindex` on those paths (server/http/app.ts), since a
 * disallowed URL can still be indexed if it's linked from elsewhere.
 */
export function loader() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /s/",
    "Disallow: /i/",
    "Disallow: /mina-grupper",
    "Disallow: /lang",
    "Disallow: /dev/",
    "",
    `Sitemap: ${getConfig().publicOrigin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

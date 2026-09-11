import { expect, test } from "@playwright/test";

/**
 * Search engines and link previews: robots.txt and the sitemap, per-page titles, canonical URLs,
 * language alternates, share-preview tags and structured data on the public pages, a separate
 * URL for English, and noindex on everything that belongs to a group or a browser.
 */

test("robots.txt keeps private paths out and points at the sitemap", async ({ request, baseURL }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/plain");
  const body = await res.text();
  for (const path of ["/s/", "/i/", "/mina-grupper", "/lang", "/dev/"]) {
    expect(body).toContain(`Disallow: ${path}`);
  }
  expect(body).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
});

test("the sitemap lists each public page in both languages with its alternates", async ({ request, baseURL }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/xml");
  const body = await res.text();
  for (const path of ["/", "/guide", "/new", "/join"]) {
    expect(body).toContain(`<loc>${baseURL}${path}</loc>`);
    expect(body).toContain(`<loc>${baseURL}${path}?lang=en</loc>`);
  }
  expect(body).toContain('hreflang="x-default"');
  expect(body).not.toContain("/s/");
});

test("the landing page carries title, canonical, alternates, share tags, structured data and a visible FAQ", async ({ page, baseURL }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/dela utgifter/i);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.{60,}/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/`);
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute("href", `${baseURL}/?lang=en`);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", `${baseURL}/`);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${baseURL}/og-image.png`);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "sv_SE");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");

  const structured = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? "{}")));
  const app = structured.find((d) => d["@type"] === "WebApplication");
  const faq = structured.find((d) => d["@type"] === "FAQPage");
  expect(app?.name).toBe("Skyldig");
  expect(faq?.mainEntity).toHaveLength(5);

  // Rich results require the FAQ to be visible on the page, matching the structured data.
  const questions = page.locator("details summary");
  await expect(questions).toHaveCount(5);
  await expect(questions.first()).toContainText(faq.mainEntity[0].name);
});

test("?lang=en serves English with its own canonical URL", async ({ page, baseURL }) => {
  await page.goto("/guide?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/How Skyldig works/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/guide?lang=en`);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${baseURL}/og-image-en.png`);
});

test("switching language from a ?lang= URL drops the parameter, so the switch sticks", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/lang")),
    page.getByRole("button", { name: "Svenska" }).click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  expect(new URL(page.url()).search).toBe("");
});

test("private paths are marked noindex; public pages are not", async ({ request }) => {
  for (const path of ["/s/doesnotexist", "/i/doesnotexist", "/mina-grupper"]) {
    const res = await request.get(path);
    expect(res.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }
  for (const path of ["/", "/guide"]) {
    const res = await request.get(path);
    expect(res.headers()["x-robots-tag"], path).toBeUndefined();
  }
});

test("the share images and web app manifest are served", async ({ request }) => {
  for (const path of ["/og-image.png", "/og-image-en.png", "/icon-192.png", "/icon-512.png"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain("image/png");
  }
  const manifest = await request.get("/site.webmanifest");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe("Skyldig");
});

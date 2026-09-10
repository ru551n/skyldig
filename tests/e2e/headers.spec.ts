import { expect, test } from "@playwright/test";

/**
 * Regression for the finding that React Router silently drops every header a loader/action
 * sets on a document response except `Set-Cookie` (no route exported a `headers` function),
 * so authenticated HTML (the /new result with the plaintext phrase/admin key, the private
 * group dashboard, the admin page) carried no `Cache-Control` and was heuristically cacheable.
 *
 * This must run after every other e2e spec file that itself does `/join` attempts (the join
 * rate limiter is shared, in-memory, per server process) — it deliberately trips the limiter
 * to assert `Retry-After` survives on the 429, which locks the client out of joining for the
 * rest of the run. "headers.spec.ts" sorts after the other current *.spec.ts files
 * alphabetically, so this is safe as things stand; keep it last if new spec files are added.
 */

test.describe.configure({ mode: "serial" });

test("landing page ('/') carries Cache-Control: no-store", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  expect(response!.headers()["cache-control"]).toContain("no-store");
});

test("GET /new carries Cache-Control: no-store", async ({ page }) => {
  const response = await page.goto("/new");
  expect(response).not.toBeNull();
  expect(response!.headers()["cache-control"]).toContain("no-store");
});

test("group dashboard and admin page carry Cache-Control: no-store", async ({ page }) => {
  let groupUrl = "";

  await test.step("create a group", async () => {
    await page.goto("/new");
    await page.getByLabel("Namn på gruppen").fill("Headers Test Group");
    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Ada");
    await participantInputs.nth(1).fill("Bo");
    // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
    await page.waitForTimeout(1_600);
    await page.getByRole("button", { name: "Skapa grupp" }).click();
    await expect(page.getByText("Gruppen är skapad")).toBeVisible();
    // The creation result gates "Till gruppen" behind a required "I have saved the admin
    // key" checkbox (a plain form, so it works without JavaScript) — tick it, then read the
    // form's action, which posts to a dedicated resource route that redirects to the clean
    // group URL.
    await page.getByLabel("Jag har sparat adminnyckeln").check();
    const href = await page.locator('form[action^="/s/"]').getAttribute("action");
    groupUrl = href!.replace(/\/bekrafta-nyckel$/, "");
  });

  await test.step("group dashboard has no-store", async () => {
    const response = await page.goto(groupUrl);
    expect(response).not.toBeNull();
    expect(response!.headers()["cache-control"]).toContain("no-store");
  });

  await test.step("admin page has no-store", async () => {
    const response = await page.goto(`${groupUrl}/admin`);
    expect(response).not.toBeNull();
    expect(response!.headers()["cache-control"]).toContain("no-store");
  });
});

test("static assets keep long-lived caching (not no-store)", async ({ page, request }) => {
  await page.goto("/");
  // Any hashed file under /assets, as emitted by the production build and served by
  // express.static with immutable/1y caching in server.js — locate one from the page itself
  // so the test doesn't hardcode a build-specific filename.
  const assetHref = await page.evaluate(() => {
    const link = document.querySelector('link[rel="stylesheet"][href^="/assets/"]');
    const script = document.querySelector('script[src^="/assets/"]');
    return (link?.getAttribute("href") ?? script?.getAttribute("src")) || null;
  });
  test.skip(!assetHref, "no /assets link/script found on the page (e.g. dev mode serving unbundled)");
  const response = await request.get(assetHref!);
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).not.toContain("no-store");
});

test("a rate-limited join response includes Retry-After", async ({ page }) => {
  await page.goto("/join");

  let sawRateLimited = false;
  for (let attempt = 0; attempt < 15 && !sawRateLimited; attempt += 1) {
    await page.getByLabel("Gruppnyckel").fill(`wrong-phrase-attempt-${attempt}`);
    const [submitResponse] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/join")),
      page.getByRole("button", { name: "Gå med" }).click(),
    ]);
    if (submitResponse.status() === 429) {
      sawRateLimited = true;
      expect(submitResponse.headers()["retry-after"]).toBeTruthy();
      const retryAfterSeconds = Number(submitResponse.headers()["retry-after"]);
      expect(retryAfterSeconds).toBeGreaterThan(0);
    }
  }

  expect(sawRateLimited).toBe(true);
});

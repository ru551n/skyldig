import { expect, test } from "@playwright/test";

/**
 * Regression for group creation (`POST /new`) rate limiting (`limiters.createSession` /
 * `createSessionGlobal` in server/modules/auth/rate-limit.ts, docs/architecture.md §4.4).
 *
 * This file uses a client identity of its own: the e2e server trusts the loopback hop
 * (`TRUST_PROXY=loopback` in playwright.config.ts), so the X-Forwarded-For below becomes this
 * file's rate-limit key. It therefore starts from a full per-client budget no matter how many
 * groups other specs created as setup from the shared loopback address, and its deliberate
 * flood below exhausts only its own budget — so it no longer has to run last.
 */

test.describe.configure({ mode: "serial" });

test.use({
  extraHTTPHeaders: { "Accept-Language": "sv-SE,sv;q=0.9", "X-Forwarded-For": "198.51.100.18" },
});

async function fillAndSubmit(page: import("@playwright/test").Page, name: string) {
  await page.goto("/new");
  await page.getByLabel("Namn på gruppen").fill(name);
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts,
  // 1.5s) -- otherwise every submission here would be rejected before it ever reaches the
  // rate limiter this file is testing.
  await page.waitForTimeout(1_600);
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/new")),
    page.getByRole("button", { name: "Skapa grupp" }).click(),
  ]);
  return response;
}

test("a normal, infrequent group creation still succeeds", async ({ page }) => {
  const response = await fillAndSubmit(page, "Rate Limit Smoke Test Group");
  expect(response.status()).toBe(200);
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
});

test("repeated POST /new from the same client trips the rate limiter with Retry-After", async ({ page }) => {
  // Starting from this file's own full budget, tripping the 18/10 min limit takes ~18
  // submissions, each held for the 1.6 s anti-bot wait — well past the default 30 s timeout.
  test.setTimeout(90_000);
  let sawRateLimited = false;

  // Up to 20 attempts: enough to trip the 18/10min per-client limit even starting from a
  // completely empty budget (this test's own prior "normal creation" call included), with
  // margin to spare when run as part of the full suite where other specs already spent some
  // of the budget before this file runs.
  for (let attempt = 0; attempt < 20 && !sawRateLimited; attempt += 1) {
    const response = await fillAndSubmit(page, `Rate Limit Flood Group ${attempt}`);
    if (response.status() === 429) {
      sawRateLimited = true;
      expect(response.headers()["retry-after"]).toBeTruthy();
      const retryAfterSeconds = Number(response.headers()["retry-after"]);
      expect(retryAfterSeconds).toBeGreaterThan(0);
    } else {
      expect(response.status()).toBe(200);
    }
  }

  expect(sawRateLimited).toBe(true);
});

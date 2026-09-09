import { expect, test } from "@playwright/test";

/**
 * Regression for group creation (`POST /new`) rate limiting (`limiters.createSession` /
 * `createSessionGlobal` in server/modules/auth/rate-limit.ts, docs/architecture.md §4.4).
 *
 * Every other e2e spec file also creates a group or two as setup for its own assertions, all
 * from the same client key (one shared loopback IP, `playwright.config.ts` runs with
 * `workers: 1`) — the per-client `createSession` budget (18/10 min, 45/h) was sized with
 * headroom above that real, measured usage specifically so this file doesn't need to run
 * first. It still needs to run *after* every file that creates groups of its own, the same
 * way headers.spec.ts documents for the join limiter, since the second test below
 * deliberately exhausts what budget remains. "new-rate-limit.spec.ts" sorts after every other
 * current *.spec.ts file alphabetically, so this is safe as things stand; keep it last if new
 * spec files that create groups are added.
 */

test.describe.configure({ mode: "serial" });

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

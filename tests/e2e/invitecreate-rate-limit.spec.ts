import { expect, test } from "@playwright/test";

/**
 * Regression for invite CREATION (`POST /s/:sid/bjud-in`, `app/routes/session/invite-create.tsx`)
 * having no rate limit at all: any authenticated member could insert unbounded
 * `session_invites` rows between cleanup runs. Now wired to `limiters.invite`/`inviteGlobal`
 * (server/modules/auth/rate-limit.ts), the same limiters invite REDEMPTION already used.
 *
 * This deliberately exhausts the per-client `invite` budget (20/10min), which is shared
 * in-memory per server process, so it must run after every other e2e spec file that creates
 * invites of its own (currently just invite.spec.ts). "invitecreate-rate-limit.spec.ts" sorts
 * after "invite.spec.ts" but before "new-rate-limit.spec.ts" (which exhausts the *separate*
 * group-creation limiter that this file's own one `/new` call also draws from) — keep it in
 * that alphabetical window if new spec files that create invites or groups are added.
 */

test.describe.configure({ mode: "serial" });

async function createGroup(page: import("@playwright/test").Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Invite Rate Limit Test");
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  const href = await page.getByRole("link", { name: "Till gruppen" }).getAttribute("href");
  expect(href).toBeTruthy();
  await page.getByRole("link", { name: "Till gruppen" }).click();
  await page.waitForURL(`**${href}`);
  return href!;
}

test("repeated invite creation from the same client trips the rate limiter", async ({ page }) => {
  const groupUrl = await createGroup(page);

  let sawRateLimited = false;

  // Each fresh page load + dialog open issues one POST to the invite-create resource route
  // (InviteDialog's fetcher only auto-submits on mount, so a full navigation is used here
  // rather than repeatedly toggling the dialog open/closed on one page, since the dialog stays
  // mounted -- via Radix's `forceMount` -- across close/reopen and its fetcher intentionally
  // does not resubmit while it already holds data from a prior open). Up to 25 attempts:
  // comfortably enough to trip the 20/10min per-client cap even starting from an empty budget.
  for (let attempt = 0; attempt < 25 && !sawRateLimited; attempt += 1) {
    await page.goto(groupUrl);
    await page.getByRole("button", { name: "Bjud in" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const rateLimitedMessage = page.getByText("För många länkar har skapats");
    const link = page.locator("p.break-all");
    await expect(rateLimitedMessage.or(link)).toBeVisible({ timeout: 10_000 });

    if (await rateLimitedMessage.isVisible()) {
      sawRateLimited = true;
    }
  }

  expect(sawRateLimited).toBe(true);
});

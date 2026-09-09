import { expect, test } from "@playwright/test";

/**
 * Anti-bot defenses on group creation (`app/routes/new.tsx`), added alongside the rate-limit
 * fix in `server/modules/auth/rate-limit.ts` as the release gate for "rate limiting alone is
 * not sufficient": a honeypot field (`website`) and a signed minimum-time-on-page token
 * (`server/modules/auth/form-token.ts`, min age 1.5s). Both must be silent to a real user
 * filling the form at ordinary human speed, and both reject a caught bot with the exact same
 * generic validation-failure response a normal form error would produce — no distinct signal.
 */

async function fillGroupForm(page: import("@playwright/test").Page, name: string) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill(name);
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
}

test("a real user filling the form at ordinary human speed still succeeds", async ({ page }) => {
  await fillGroupForm(page, "Anti-bot Human Speed Group");
  // Simulate a human actually reading/filling the form before submitting, comfortably past
  // the 1.5s minimum-age threshold.
  await page.waitForTimeout(1_800);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
});

test("submitting well under 1.5s after the form rendered is rejected generically", async ({ page }) => {
  await fillGroupForm(page, "Anti-bot Too Fast Group");
  // No deliberate delay: fill + click happens in well under 1.5s, exactly what a bot skipping
  // the human fill time would do.
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Namn krävs.")).toBeVisible();
  await expect(page.getByText("Gruppen är skapad")).not.toBeVisible();
});

test("filling the honeypot field is rejected the same generic way", async ({ page }) => {
  await fillGroupForm(page, "Anti-bot Honeypot Group");
  // A bot that fills every field it finds, including the hidden decoy.
  await page.locator('input[name="website"]').fill("https://spam.example", { force: true });
  // Wait past the minimum-age threshold so only the honeypot is under test here, isolating it
  // from the timing check.
  await page.waitForTimeout(1_800);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Namn krävs.")).toBeVisible();
  await expect(page.getByText("Gruppen är skapad")).not.toBeVisible();
});

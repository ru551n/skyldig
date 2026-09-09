import { expect, test } from "@playwright/test";

/**
 * Regression test for the "Expense edit form falls back to array index for
 * split ordering" gap (docs/todo.md): the edit route now threads each
 * participant's real `position` into ExpenseForm, so the split preview's
 * rounding remainder is placed by position, matching what the server
 * actually stores.
 *
 * 100 SEK split across 3 participants doesn't divide evenly (33.33... each),
 * so the extra minor unit lands on the participant with the lowest
 * position (Anna, added first) — 33,34 / 33,33 / 33,33 — making the
 * placement observable.
 */
test("expense edit split preview orders the rounding remainder by position, matching the server", async ({
  page,
}) => {
  await page.goto("/new");
  await page.getByLabel("Namn på gruppen").fill("Split Order Test");
  await page.getByLabel("Valuta").selectOption("SEK");

  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Anna");
  await participantInputs.nth(1).fill("Johan");
  await page.getByRole("button", { name: "Lägg till deltagare" }).click();
  await page.locator('input[name="participant"]').nth(2).fill("Peter");

  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();

  const sessionLink = page.getByRole("link", { name: "Till gruppen" });
  const href = await sessionLink.getAttribute("href");
  const groupUrl = href!;
  await sessionLink.click();
  await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

  await page.goto(`${groupUrl}/utgifter/ny`);
  await page.getByLabel("Vad gällde det?").fill("Middag");
  await page.getByLabel("Belopp").fill("100");
  await page.getByLabel("Vem betalade?").selectOption({ label: "Anna" });
  await page.getByRole("button", { name: "Markera alla", exact: true }).click();

  const expectedShares = [
    ["Anna", "33,34 kr"],
    ["Johan", "33,33 kr"],
    ["Peter", "33,33 kr"],
  ] as const;

  await test.step("new-expense preview places the remainder on the lowest-position participant", async () => {
    const preview = page.getByText("Så här delas det").locator("xpath=ancestor::div[1]");
    const rows = preview.locator("li");
    await expect(rows).toHaveCount(3);
    for (const [name, amount] of expectedShares) {
      await expect(preview.locator("li", { hasText: name })).toContainText(amount);
    }
  });

  await page.getByRole("button", { name: "Spara utgift" }).click();
  await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

  await page.getByRole("link", { name: "Middag" }).click();
  await expect(page.getByRole("heading", { name: "Middag" })).toBeVisible();

  const storedShares: Record<string, string> = {};
  await test.step("read back what the server actually stored", async () => {
    const sharesSection = page.getByText("Så här delas det").locator("xpath=ancestor::section[1]");
    for (const [name] of expectedShares) {
      const text = await sharesSection.locator("div", { hasText: name }).last().innerText();
      storedShares[name] = text;
    }
  });

  await page.getByRole("link", { name: "Ändra" }).click();

  await test.step("edit form's split preview matches what the server stored", async () => {
    const preview = page.getByText("Så här delas det").locator("xpath=ancestor::div[1]");
    const rows = preview.locator("li");
    await expect(rows).toHaveCount(3);
    for (const [name, amount] of expectedShares) {
      const row = preview.locator("li", { hasText: name });
      await expect(row).toContainText(amount);
      await expect(row).toContainText(storedShares[name]!.match(/[\d,]+\s*kr/)![0]);
    }
  });
});

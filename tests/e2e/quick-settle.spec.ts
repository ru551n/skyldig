import { expect, test, type Page } from "@playwright/test";

/**
 * Settle-up rows link straight to the payment form, prefilled with who pays whom and how much —
 * from the overview (the quick link) and from Gör upp, whose relative link used to resolve to a
 * page that didn't exist.
 */

// Own rate-limit identity (the e2e server trusts the loopback hop).
test.use({ extraHTTPHeaders: { "Accept-Language": "sv-SE,sv;q=0.9", "X-Forwarded-For": "198.51.100.50" } });

async function groupWithExpense(page: Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Settle test");
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Anna");
  await participantInputs.nth(1).fill("Johan");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  await page.getByLabel("Jag har sparat adminnyckeln").check();
  const href = (await page.locator('form[action^="/s/"]').getAttribute("action"))!.replace(/\/bekrafta-nyckel$/, "");
  await page.getByRole("button", { name: "Till gruppen" }).click();
  await page.waitForURL(`**${href}`);
  // Anna pays 800 for both: Johan owes Anna 400.
  await page.goto(`${href}/utgifter/ny`);
  await page.getByLabel("Vad gällde det?").fill("Middag");
  await page.getByLabel("Belopp").fill("800");
  await page.getByRole("button", { name: "Markera alla", exact: true }).click();
  // The split preview is computed in the browser, so seeing it proves the page is interactive
  // and holds these values — typing before hydration can otherwise lose them under load.
  const preview = page.getByText("Så här delas det").locator("xpath=ancestor::div[1]");
  await expect(preview.locator("li", { hasText: "Johan" })).toContainText("400,00 kr");
  await page.getByRole("button", { name: "Spara utgift" }).click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  return href;
}

async function expectPrefilled(page: Page, href: string) {
  await expect(page).toHaveURL(new RegExp(`${href}/betalningar/ny\\?`));
  await expect(page.locator('input[name="amountText"]')).toHaveValue("400.00");
  await expect(page.locator('select[name="payerPublicId"] option:checked')).toHaveText("Johan");
  await expect(page.locator('select[name="recipientPublicId"] option:checked')).toHaveText("Anna");
}

test("settle-up rows open the payment form prefilled, from the overview and from Gör upp", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const href = await groupWithExpense(page);

  await test.step("from Gör upp (used to lead to a missing page)", async () => {
    await page.goto(`${href}/gor-upp`);
    await page.getByRole("link", { name: /Johan.*Anna.*Markera betald/ }).click();
    await expectPrefilled(page, href);
  });

  await test.step("from the overview's quick link, then saving settles it", async () => {
    await page.goto(href);
    await page.getByRole("link", { name: /Johan.*Anna.*Markera betald/ }).click();
    await expectPrefilled(page, href);
    await page.getByRole("button", { name: "Spara betalning" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/betalningar/ny"));
    await page.goto(href);
    await expect(page.getByRole("link", { name: /Markera betald/ })).toHaveCount(0);
  });
});

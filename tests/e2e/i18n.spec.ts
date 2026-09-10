import { expect, test, type Page } from "@playwright/test";

async function createGroup(page: Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Language test");
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  await page.getByLabel("Jag har sparat adminnyckeln").check();
  const href = await page.locator('form[action^="/s/"]').getAttribute("action");
  expect(href).toBeTruthy();
  const groupUrl = href!.replace(/\/bekrafta-nyckel$/, "");
  await page.getByRole("button", { name: "Till gruppen" }).click();
  await page.waitForURL(`**${groupUrl}`);
  return groupUrl;
}

/**
 * Locale selection and persistence (docs/todo.md "Add English as a second language"): a first
 * visit uses `Accept-Language` to pick the interface language, and the switcher persists an
 * explicit choice in the `skyldig_lang` cookie across reloads.
 */
test.describe("interface language", () => {
  test("Accept-Language: en shows English copy and sets <html lang>", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en" } });
    const page = await context.newPage();

    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Create a group" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join a group" })).toBeVisible();

    await context.close();
  });

  test("the switcher sets Swedish and it persists across a reload", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en" } });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Create a group" })).toBeVisible();

    // The switcher is two labelled flag buttons in one form (see LocaleSwitcher.tsx), each a
    // native submit button — no hydration wait needed, it works even before React attaches.
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/lang")),
      page.getByRole("button", { name: "Svenska" }).click(),
    ]);

    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page.getByRole("link", { name: "Skapa grupp" })).toBeVisible();

    await page.reload();

    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page.getByRole("link", { name: "Skapa grupp" })).toBeVisible();

    await context.close();
  });

  test("inside a group, the mobile header toggle switches language and stays on the group", async ({ page }) => {
    // The session header (and this toggle) is the phone layout; on wide screens the side
    // rail carries the full two-flag switcher instead.
    await page.setViewportSize({ width: 390, height: 844 });
    const groupUrl = await createGroup(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");

    const header = page.locator("header");
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/lang")),
      header.getByRole("button", { name: "Språk: English" }).click(),
    ]);

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(new URL(page.url()).pathname).toBe(groupUrl);
    await expect(header.getByRole("button", { name: "Language: Svenska" })).toBeVisible();
  });
});

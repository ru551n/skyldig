import { expect, test } from "@playwright/test";

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
});

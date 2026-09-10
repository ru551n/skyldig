import { expect, test } from "@playwright/test";

test.describe("landing", () => {
  test("renders both primary actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Skapa grupp" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Gå med i grupp" })).toBeVisible();
  });
});

test.describe("create a group", () => {
  test("shows the phrase and admin key on success", async ({ page }) => {
    await page.goto("/new");

    await page.getByLabel("Namn på gruppen").fill("Japan 2026");

    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Peter");
    await participantInputs.nth(1).fill("Johan");
    await page.getByRole("button", { name: "Lägg till deltagare" }).click();
    await page.locator('input[name="participant"]').nth(2).fill("Anna");

    // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
    await page.waitForTimeout(1_600);
    await page.getByRole("button", { name: "Skapa grupp" }).click();

    await expect(page.getByText("Gruppen är skapad")).toBeVisible();

    const phraseText = await page.locator("p.tabular.select-all").first().innerText();
    const words = phraseText.trim().split("-");
    expect(words).toHaveLength(5);

    const adminKeyText = await page.locator("p.tabular.select-all").nth(1).innerText();
    expect(adminKeyText.startsWith("admin-")).toBe(true);

    // TODO: once the /s/:sid dashboard route exists (added by the next agent), assert the
    // page actually renders instead of just the link target — it may 404 until then.
    await page.getByLabel("Jag har sparat adminnyckeln").check();
    const sessionLink = page.getByRole("button", { name: "Till gruppen" });
    await expect(sessionLink).toBeVisible();
    const href = await page.locator('form[action^="/s/"]').getAttribute("action");
    expect(href).toMatch(/^\/s\/[a-z0-9]+$/);

    // Stash the phrase for the join test via a global (Playwright workers are separate
    // processes per file but this spec runs serially within one file/worker).
    test.info().annotations.push({ type: "phrase", description: phraseText.trim() });
  });
});

test.describe("join a group", () => {
  test("joining with a wrong phrase shows the generic error", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/join");

    await page.getByLabel("Gruppnyckel").fill("fel-nyckel-som-inte-finns-alls-nej");
    await page.getByRole("button", { name: "Gå med" }).click();

    await expect(page.getByText("Nyckeln stämmer inte. Kontrollera stavningen och försök igen.")).toBeVisible();
    await expect(page).toHaveURL(/\/join$/);

    await context.close();
  });

  test("joining with the created group's phrase (pasted with spaces) lands on the group URL", async ({
    page,
    browser,
  }) => {
    // Create a group first, in this same page, to get a fresh phrase.
    await page.goto("/new");
    await page.getByLabel("Namn på gruppen").fill("Norge 2027");
    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Sara");
    await participantInputs.nth(1).fill("Nils");
    // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
    await page.waitForTimeout(1_600);
    await page.getByRole("button", { name: "Skapa grupp" }).click();
    await expect(page.getByText("Gruppen är skapad")).toBeVisible();

    const phraseText = (await page.locator("p.tabular.select-all").first().innerText()).trim();
    const phraseWithSpaces = phraseText.split("-").join(" ");

    // Join from a fresh browser context (a different "browser" / no existing cookie).
    const context = await browser.newContext();
    const joinPage = await context.newPage();
    await joinPage.goto("/join");
    await joinPage.getByLabel("Gruppnyckel").fill(phraseWithSpaces);
    await joinPage.getByRole("button", { name: "Gå med" }).click();

    await expect(joinPage).toHaveURL(/\/s\/[a-z0-9]+$/);

    await context.close();
  });
});

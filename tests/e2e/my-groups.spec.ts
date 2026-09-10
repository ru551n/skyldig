import { expect, test, type Page } from "@playwright/test";

/**
 * My groups: every group this browser has joined, reachable from inside a group, with a
 * confirmed way to leave each one that returns to the list.
 */

// Own rate-limit identity (the e2e server trusts the loopback hop): this file creates two groups.
test.use({ extraHTTPHeaders: { "Accept-Language": "sv-SE,sv;q=0.9", "X-Forwarded-For": "198.51.100.40" } });

async function createGroup(page: Page, name: string) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill(name);
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  await page.getByLabel("Jag har sparat adminnyckeln").check();
  const href = (await page.locator('form[action^="/s/"]').getAttribute("action"))!.replace(/\/bekrafta-nyckel$/, "");
  await page.getByRole("button", { name: "Till gruppen" }).click();
  await page.waitForURL(`**${href}`);
  return href;
}

test("My groups lists every joined group, and leaving one asks first and returns to the list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cabin = await createGroup(page, "Stugresa");
  const japan = await createGroup(page, "Japan");

  await test.step("creating a second group keeps access to the first", async () => {
    // Group creation used to start a fresh browser session, replacing the cookie and dropping
    // access to every group the browser had already joined.
    const response = await page.goto(cabin);
    expect(response?.status()).toBe(200);
    await page.goto(japan);
  });

  await test.step("reachable from the phone menu", async () => {
    await page.getByRole("button", { name: "Meny" }).click();
    await page.getByRole("dialog", { name: "Meny" }).getByRole("link", { name: "Mina grupper" }).click();
    await page.waitForURL("**/mina-grupper");
    await expect(page.getByRole("heading", { name: "Mina grupper" })).toBeVisible();
  });

  const list = page.getByRole("list");
  await expect(list.getByRole("link")).toHaveText([/Japan/, /Stugresa/]);

  await test.step("Avbryt keeps the group", async () => {
    await page.getByRole("button", { name: "Lämna Japan" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Lämna Japan?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Avbryt" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(list.getByRole("link")).toHaveCount(2);
  });

  await test.step("confirming leaves it and comes back with a notice", async () => {
    await page.getByRole("button", { name: "Lämna Japan" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Lämna gruppen" }).click();
    await page.waitForURL("**/mina-grupper?lamnad=1");
    await expect(page.getByRole("status")).toHaveText("Du har lämnat gruppen.");
    await expect(list.getByRole("link")).toHaveText([/Stugresa/]);
  });

  await test.step("the group it left is no longer accessible from this browser", async () => {
    const response = await page.goto(japan);
    expect(response?.status()).toBe(404);
  });
});

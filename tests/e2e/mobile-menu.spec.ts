import { expect, test, type Page } from "@playwright/test";

/**
 * On phones the side rail (group pages, Admin, leaving) is hidden, so the header's menu is the
 * only way to reach those. Before it existed, Admin — and with it deleting a group — could not
 * be reached on a phone at all.
 */

async function createGroup(page: Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Menu test");
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

// One group for every check below: the whole e2e suite shares one server and so one per-client
// group-creation budget (server/modules/auth/rate-limit.ts), and later specs such as
// new-rate-limit.spec.ts need headroom left in it. Leaving the group is last, since it ends access.
test("the phone menu reaches every group page, closes cleanly, and confirms leaving in place", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const groupUrl = await createGroup(page);
  const trigger = page.getByRole("button", { name: "Meny" });

  await test.step("lists every group page, the expiry date, and reaches Admin", async () => {
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Meny" });
    await expect(menu).toBeVisible();
    for (const name of ["Översikt", "Aktivitet", "Gör upp", "Deltagare", "Admin"]) {
      await expect(menu.getByRole("link", { name })).toBeVisible();
    }
    await expect(menu.getByText(/Går ut/)).toBeVisible();
    await menu.getByRole("link", { name: "Admin" }).click();
    await page.waitForURL(`**${groupUrl}/admin`);
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  await test.step("closes on Escape and returns focus to its button", async () => {
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "Meny" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  await test.step("asks before leaving, inside the same dialog; Avbryt goes back", async () => {
    await trigger.click();
    await page.getByRole("dialog", { name: "Meny" }).getByRole("button", { name: "Lämna gruppen" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByRole("heading")).not.toHaveText("Meny");
    await expect(confirm.getByRole("button", { name: "Avbryt" })).toBeFocused();
    await confirm.getByRole("button", { name: "Avbryt" }).click();
    await expect(page.getByRole("dialog", { name: "Meny" })).toBeVisible();

    await page.getByRole("dialog", { name: "Meny" }).getByRole("button", { name: "Lämna gruppen" }).click();
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/s/")),
      page.getByRole("dialog").getByRole("button", { name: "Lämna gruppen" }).click(),
    ]);
  });
});

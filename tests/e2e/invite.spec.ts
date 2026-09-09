import { expect, test } from "@playwright/test";

/**
 * The invite/QR flow: docs/todo.md "Share a group by QR code or link". The access phrase
 * itself never appears here — only a short-lived, single-use invite token travels in the
 * URL fragment.
 */

async function createGroup(page: import("@playwright/test").Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Invite test");
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

test("inviting shows a QR code and a link that a stranger can redeem once", async ({ page, browser }) => {
  const groupUrl = await createGroup(page);

  await page.getByRole("button", { name: "Bjud in" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const link = await page.locator("p.break-all").innerText();
  expect(link).toContain("/i/");
  expect(link).toContain("#");
  // The token lives only in the fragment, never in the path or a query string.
  expect(new URL(link).search).toBe("");
  await expect(page.getByRole("dialog").locator("svg").first()).toBeVisible();

  // A completely fresh browser context (no cookies) redeems the invite.
  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await strangerPage.goto(link);
  await strangerPage.waitForURL(`**${groupUrl}`, { timeout: 10_000 });
  expect(strangerPage.url()).not.toContain("#");

  // The same link cannot be redeemed a second time.
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto(link);
  await expect(secondPage.getByText("Länken fungerar inte längre")).toBeVisible();
  expect(secondPage.url()).not.toContain(groupUrl);

  await strangerContext.close();
  await secondContext.close();
});

test("the share button calls the Web Share API with the invite URL when available", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shareCalls: unknown[] }).__shareCalls = [];
    Object.defineProperty(window.navigator, "share", {
      value: (data: unknown) => {
        (window as unknown as { __shareCalls: unknown[] }).__shareCalls.push(data);
        return Promise.resolve();
      },
      configurable: true,
    });
  });

  await createGroup(page);
  await page.getByRole("button", { name: "Bjud in" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Dela" }).click();

  const calls = await page.evaluate(() => (window as unknown as { __shareCalls: { url: string }[] }).__shareCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toMatch(/^https?:\/\/.+\/i\/.+#.+/);
});

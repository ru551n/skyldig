import { expect, test, type Page } from "@playwright/test";

/**
 * The phone's bottom tab bar: Översikt, Ny utgift, Ny betalning, Deltagare on every group page.
 * It replaced the header's back arrow (which only ever led to Översikt) and the old action bar.
 */

// Own rate-limit identity (the e2e server trusts the loopback hop).
test.use({ extraHTTPHeaders: { "Accept-Language": "sv-SE,sv;q=0.9", "X-Forwarded-For": "198.51.100.42" } });

async function createGroup(page: Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Tab test");
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

async function clippedLabels(page: Page, navName: string) {
  return page
    .getByRole("navigation", { name: navName })
    .getByRole("link")
    .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
}

test("the tab bar marks the current page, hides while typing, and fits small phones", async ({ page }) => {
  // A desktop browser has no on-screen keyboard, so stand in a visualViewport whose height the
  // test can shrink the way a phone keyboard does.
  await page.addInitScript(() => {
    const fake = new EventTarget() as EventTarget & { height: number; width: number };
    let override: number | null = null;
    Object.defineProperty(fake, "height", { get: () => override ?? window.innerHeight });
    Object.defineProperty(fake, "width", { get: () => window.innerWidth });
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
    (window as unknown as { __setViewportHeight: (h: number | null) => void }).__setViewportHeight = (h) => {
      override = h;
      fake.dispatchEvent(new Event("resize"));
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const href = await createGroup(page);
  const tabs = page.getByRole("navigation", { name: "Gruppens huvudsidor" });

  await test.step("four tabs, Översikt marked, and no back arrow", async () => {
    await expect(tabs.getByRole("link")).toHaveText(["Översikt", "Ny utgift", "Ny betalning", "Deltagare"]);
    await expect(tabs.getByRole("link", { name: "Översikt" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Tillbaka" })).toHaveCount(0);
  });

  await test.step("shown on a form page too, and marks it", async () => {
    await tabs.getByRole("link", { name: "Ny utgift" }).click();
    await page.waitForURL(`**${href}/utgifter/ny`);
    await expect(tabs.getByRole("link", { name: "Ny utgift" })).toHaveAttribute("aria-current", "page");
  });

  await test.step("stays while a field merely has focus (the form focuses one on load)", async () => {
    await expect(page.locator('input[name="description"]')).toBeFocused();
    await expect(tabs).toBeVisible();
  });

  await test.step("hidden while the on-screen keyboard is up, back once it closes", async () => {
    await page.evaluate(() => (window as unknown as { __setViewportHeight: (h: number) => void }).__setViewportHeight(300));
    await expect(tabs).toBeHidden();
    await page.evaluate(() => (window as unknown as { __setViewportHeight: (h: number | null) => void }).__setViewportHeight(null));
    await expect(tabs).toBeVisible();
  });

  await test.step("a page with no tab of its own marks none", async () => {
    await page.goto(`${href}/aktivitet`);
    await expect(tabs).toBeVisible();
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0);
  });

  await test.step("no label is cut off at 320px, in either language", async () => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(href);
    expect(await clippedLabels(page, "Gruppens huvudsidor")).toEqual([]);
    await page.getByRole("banner").getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(await clippedLabels(page, "Main group pages")).toEqual([]);
  });
});

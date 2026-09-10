import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility floor checks (per docs/design.md "Accessibility floor") on
 * the landing page, the create-group form, a session dashboard, and the
 * expense form: exactly one h1, every form control has an accessible name,
 * the skip link is the first focusable element and moves focus into main,
 * a dialog traps focus and closes on Escape (returning focus to its
 * trigger), reduced motion doesn't break rendering, and axe reports no
 * serious/critical violations.
 */

const SERIOUS_OR_CRITICAL = new Set(["serious", "critical"]);

async function assertOneH1(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
}

async function assertAllControlsLabeled(page: Page) {
  const problems = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("input:not([type=hidden]), select, textarea"));
    return controls
      .filter((el) => {
        // A control inside an aria-hidden ancestor (e.g. the anti-bot honeypot field in
        // new.tsx) is never exposed to assistive tech at all, so it genuinely needs no
        // accessible name — axe itself excludes aria-hidden nodes from this same check, which
        // is why only this hand-rolled check needs to learn the same exemption.
        if (el.closest('[aria-hidden="true"]')) return false;
        const hasAriaLabel = !!el.getAttribute("aria-label")?.trim();
        const hasAriaLabelledby = !!el.getAttribute("aria-labelledby")?.trim();
        const labels = (el as HTMLInputElement).labels;
        const hasLabelEl = !!labels && labels.length > 0;
        return !(hasAriaLabel || hasAriaLabelledby || hasLabelEl);
      })
      .map((el) => el.outerHTML.slice(0, 160));
  });
  expect(problems, `Unlabeled controls found:\n${problems.join("\n")}`).toEqual([]);
}

async function assertNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => SERIOUS_OR_CRITICAL.has(v.impact ?? ""));
  expect(
    serious,
    `Serious/critical axe violations:\n${serious.map((v) => `${v.id}: ${v.description} (${v.nodes.length} nodes)`).join("\n")}`,
  ).toEqual([]);
}

async function assertReducedMotionDoesNotBreakRendering(page: Page, url: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

test.describe.configure({ mode: "serial" });

test.describe("accessibility floor", () => {
  /**
   * Creates a group on the page under test so the browser context holds the access
   * grant. Creating it in a separate context (which is then closed) would leave every
   * session URL returning 404, and the checks below would pass vacuously against an
   * error page.
   */
  async function createGroup(page: Page): Promise<string> {
    await page.goto("/new");
    await page.getByLabel("Namn på gruppen").fill("A11y Test Group");
    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Ada");
    await participantInputs.nth(1).fill("Bo");
    // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
    await page.waitForTimeout(1_600);
    await page.getByRole("button", { name: "Skapa grupp" }).click();
    await expect(page.getByText("Gruppen är skapad")).toBeVisible();
    // The creation result gates "Till gruppen" behind a required "I have saved the admin
    // key" checkbox (a plain form, so it works without JavaScript) — tick it, then read the
    // form's action, which posts to a dedicated resource route that redirects to the clean
    // group URL.
    await page.getByLabel("Jag har sparat adminnyckeln").check();
    const href = await page.locator('form[action^="/s/"]').getAttribute("action");
    expect(href, "expected a link to the created group").toBeTruthy();
    return href!.replace(/\/bekrafta-nyckel$/, "");
  }

  let groupUrl = "";

  test.beforeEach(async ({ page }) => {
    groupUrl = await createGroup(page);
  });

  const pages = () => [
    { name: "landing page", url: "/" },
    { name: "create form", url: "/new" },
    { name: "dashboard", url: () => groupUrl },
    { name: "expense form", url: () => `${groupUrl}/utgifter/ny` },
  ];

  test("each page has exactly one h1, labeled controls, and no serious/critical axe violations", async ({ page }) => {
    for (const spec of pages()) {
      const url = typeof spec.url === "function" ? spec.url() : spec.url;
      await test.step(spec.name, async () => {
        await page.goto(url);
        await assertOneH1(page);
        await assertAllControlsLabeled(page);
        await assertNoSeriousAxeViolations(page);
      });
    }
  });

  test("reduced motion does not break rendering on any of the four pages", async ({ page }) => {
    for (const spec of pages()) {
      const url = typeof spec.url === "function" ? spec.url() : spec.url;
      await test.step(spec.name, async () => {
        await assertReducedMotionDoesNotBreakRendering(page, url);
      });
    }
  });

  test("the skip link is the first focusable element and moves focus into main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim(),
      href: (document.activeElement as HTMLAnchorElement | null)?.getAttribute("href"),
    }));
    expect(focused.tag).toBe("A");
    expect(focused.href).toBe("#main");
    expect(focused.text).toBe("Hoppa till innehållet");

    await page.keyboard.press("Enter");

    const afterActivation = await page.evaluate(() => {
      const active = document.activeElement;
      const main = document.getElementById("main");
      return {
        activeIsMain: active === main,
        activeIsInsideMain: !!main && !!active && main.contains(active) && active !== document.body,
        activeTag: active?.tagName,
      };
    });
    expect(
      afterActivation.activeIsMain || afterActivation.activeIsInsideMain,
      `Expected focus to move into #main after activating the skip link, but activeElement was <${afterActivation.activeTag}>`,
    ).toBe(true);
  });

  test("a dialog traps focus and closes on Escape, returning focus to its trigger", async ({ page }) => {
    await page.goto(`${groupUrl}/deltagare`);

    const trigger = page.getByRole("button", { name: "Byt namn" }).first();
    await trigger.focus();
    await trigger.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Focus should have moved inside the dialog.
    const focusInDialog = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg && dlg.contains(document.activeElement);
    });
    expect(focusInDialog).toBe(true);

    // Tabbing stays within the dialog (focus trap): tab many times and confirm
    // focus never escapes to something outside the dialog.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const stillInDialog = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        return !!dlg && dlg.contains(document.activeElement);
      });
      expect(stillInDialog).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const isTriggerFocused = await trigger.evaluate((el) => el === document.activeElement);
    expect(isTriggerFocused).toBe(true);
  });
});

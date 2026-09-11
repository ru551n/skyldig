import { expect, test, type Page } from "@playwright/test";

import { sv } from "../../app/i18n/sv.ts";
import { en } from "../../app/i18n/en.ts";

/**
 * Detects Swedish text leaking into the English interface (docs/todo.md "Add English as a
 * second language"). Rather than grepping source for hardcoded strings — which badly
 * undercounts, since most Swedish UI words (e.g. "Idag", "Spara", "Deltagare") carry no
 * diacritics and are invisible to a å/ä/ö grep — this spec visits every page and important
 * state *in English* and inspects what actually rendered: visible body text, `document.title`,
 * and every `aria-label`/`title`/`placeholder`/`alt` attribute.
 *
 * The blacklist of "Swedish-only" words is built programmatically from the catalogs
 * themselves (`app/i18n/sv.ts` minus `app/i18n/en.ts`) rather than hand-maintained, so it
 * can't silently go stale as the catalogs grow. A literal å/ä/ö character is always a giveaway
 * on its own.
 */

// ---------------------------------------------------------------------------
// Build the Swedish-only word blacklist from the catalogs themselves.
// ---------------------------------------------------------------------------

/** Recursively collects every literal string in a catalog, calling message functions with a
 * proxy that stringifies any interpolated param as "X" so the surrounding literal text (e.g.
 * "X betalade") is still captured. */
function collectLiterals(node: unknown, acc: string[]): void {
  if (typeof node === "string") {
    acc.push(node);
  } else if (typeof node === "function") {
    const proxy = new Proxy(
      {},
      { get: () => "X" },
    ) as never;
    try {
      const result = (node as (params: never) => string)(proxy);
      if (typeof result === "string") acc.push(result);
    } catch {
      // Message functions here are pure template interpolation — this should never throw,
      // but if a future one does, just skip it rather than failing catalog-word extraction.
    }
  } else if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) collectLiterals(value, acc);
  }
}

function wordsOf(strings: string[]): Set<string> {
  const words = new Set<string>();
  for (const s of strings) {
    for (const w of s.toLowerCase().match(/[a-zåäö]+/g) ?? []) {
      if (w.length >= 3) words.add(w);
    }
  }
  return words;
}

const svLiterals: string[] = [];
collectLiterals(sv, svLiterals);
const enLiterals: string[] = [];
collectLiterals(en, enLiterals);

const svWords = wordsOf(svLiterals);
const enWords = wordsOf(enLiterals);

/** The language switcher deliberately shows endonyms ("Svenska"/"English") regardless of the
 * active locale — these are correct on the English page and must never be flagged. (In
 * practice both already appear verbatim in `en.ts` too, so the set-difference below excludes
 * them on its own; this is a defensive backstop.) */
// Words shared by both languages that only look Swedish-only to the diff below: the language
// endonyms, and currency names ("euro" appears in the Swedish FAQ; the English one says "euros").
const ALLOWLIST = new Set(["svenska", "english", "euro"]);

const swedishOnlyWords = [...svWords].filter((w) => !enWords.has(w) && !ALLOWLIST.has(w));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const swedishWordRegex = new RegExp(`\\b(${swedishOnlyWords.map(escapeRegExp).join("|")})\\b`, "i");
const diacriticRegex = /[åäöÅÄÖ]/;

function findSwedishLeak(text: string): string | null {
  const diacriticMatch = text.match(diacriticRegex);
  if (diacriticMatch) {
    return `diacritic "${diacriticMatch[0]}" in: ${JSON.stringify(text.slice(0, 160))}`;
  }
  const wordMatch = text.match(swedishWordRegex);
  if (wordMatch) {
    return `Swedish word "${wordMatch[0]}" in: ${JSON.stringify(text.slice(0, 160))}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Page inspection
// ---------------------------------------------------------------------------

async function collectPageTexts(page: Page): Promise<{ source: string; text: string }[]> {
  const results: { source: string; text: string }[] = [];
  results.push({ source: "document.title", text: await page.title() });
  results.push({ source: "body.innerText", text: await page.locator("body").innerText() });

  const attrs = await page.evaluate(() => {
    const out: { attr: string; value: string }[] = [];
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      document.querySelectorAll(`[${attr}]`).forEach((el) => {
        const v = el.getAttribute(attr);
        if (v) out.push({ attr, value: v });
      });
    }
    return out;
  });
  for (const a of attrs) results.push({ source: a.attr, text: a.value });

  return results;
}

const leaks: string[] = [];

/** Inspects the current page for Swedish leaks and records any findings (does not throw), so
 * one run of the spec surfaces every leak across every state instead of stopping at the first. */
async function checkPage(page: Page, stepLabel: string): Promise<void> {
  const texts = await collectPageTexts(page);
  for (const { source, text } of texts) {
    if (!text) continue;
    const leak = findSwedishLeak(text);
    if (leak) {
      leaks.push(`[${stepLabel}] (${source}) ${leak}`);
    }
  }
}

test.describe.configure({ mode: "serial" });

// This single test walks the entire app (landing, group creation, every session page, every
// dialog, admin elevation with a second browser context) end to end, well beyond the default
// 30s test timeout.
test.setTimeout(180_000);

test("no Swedish text leaks into the English interface", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en" },
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await expect.poll(() => true).toBe(true); // keep lint happy about awaited context below

  await test.step("landing page", async () => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await checkPage(page, "landing");
  });

  await test.step("/new: empty form", async () => {
    await page.goto("/new");
    await checkPage(page, "new: empty form");
  });

  let groupUrl = "";
  let groupName = "";
  let phrase = "";

  await test.step("/new: validation error from an empty submit", async () => {
    // Deliberately submitted *before* the anti-bot minimum-time-on-page threshold
    // (server/modules/auth/form-token.ts, 1.5s) so this goes through the same
    // `genericValidationFailure()` path as a caught bot — same "A name is required." copy —
    // *without* spending any of the per-client group-creation rate-limit budget (that check
    // sits after the anti-bot check in app/routes/new.tsx, so a rejected-as-bot submission
    // never reaches it). tests/e2e/new-rate-limit.spec.ts relies on every other spec file
    // leaving it headroom; a real, budget-consuming submission here would eat into that.
    await page.locator('input[name="name"]').fill(" ");
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByText("A name is required.")).toBeVisible();
    await checkPage(page, "new: validation error");
  });

  await test.step("/new: create a group -> result page with admin-key ack", async () => {
    // Now past the anti-bot minimum-time-on-page threshold, so this submission reaches real
    // validation and the rate limiter (the one createSession budget unit this spec spends).
    await page.waitForTimeout(1_600);
    groupName = "English UI Test";
    await page.locator('input[name="name"]').fill(groupName);
    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Ada");
    await participantInputs.nth(1).fill("Bo");
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByText("Group created")).toBeVisible();
    await checkPage(page, "new: result page");

    phrase = (await page.locator("p.tabular.select-all").first().innerText()).trim();

    await page.getByLabel("I have saved the admin key").check();
    const href = await page.locator('form[action^="/s/"]').getAttribute("action");
    expect(href).toBeTruthy();
    groupUrl = href!.replace(/\/bekrafta-nyckel$/, "");
    await page.getByRole("button", { name: "Go to group" }).click();
    await page.waitForURL(`**${groupUrl}`);
  });

  await test.step("/join: form", async () => {
    await page.goto("/join");
    await checkPage(page, "join: form");
  });

  await test.step("/join: wrong-phrase error", async () => {
    await page.getByLabel("Group key").fill("totally-wrong-phrase-xyz-abc");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByText("That key isn't right. Check the spelling and try again.")).toBeVisible();
    await checkPage(page, "join: wrong-phrase error");
  });

  await test.step("/guide", async () => {
    await page.goto("/guide");
    await checkPage(page, "guide");
  });

  // A fresh, plain-member context: joins with the phrase now (before the admin-key dialogs
  // below might rotate it), used later for the un-elevated admin key-entry form — the group
  // creator's own `page` is granted "admin" immediately on creation (app/routes/new.tsx), so
  // it never shows that form.
  const memberContext = await browser.newContext({
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en" },
    viewport: { width: 1280, height: 900 },
  });
  const memberPage = await memberContext.newPage();
  await test.step("member context: join with the phrase", async () => {
    await memberPage.goto("/join");
    await memberPage.getByLabel("Group key").fill(phrase);
    await memberPage.getByRole("button", { name: "Join" }).click();
    await expect(memberPage).toHaveURL(new RegExp(`${groupUrl}$`));
  });

  await test.step("invite redeem page", async () => {
    // Create a one-time invite as the group's own (already-admin) page, then redeem it as a
    // stranger context so the redeem page (loading + eventual redirect) is inspected.
    await page.goto(groupUrl);
    await page.getByRole("button", { name: "Invite" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const link = await page.locator("p.break-all").innerText();
    await page.keyboard.press("Escape");

    const strangerContext = await browser.newContext({
      locale: "en-US",
      extraHTTPHeaders: { "Accept-Language": "en" },
    });
    const strangerPage = await strangerContext.newPage();
    await strangerPage.goto(link);
    await checkPage(strangerPage, "invite redeem page");
    await strangerPage.waitForURL(`**${groupUrl}`, { timeout: 10_000 });
    await strangerContext.close();
  });

  await test.step("group dashboard (empty, no expenses yet)", async () => {
    await page.goto(groupUrl);
    await checkPage(page, "dashboard: empty");
  });

  await test.step("expense: new form", async () => {
    await page.goto(`${groupUrl}/utgifter/ny`);
    await checkPage(page, "expense: new form");
  });

  await test.step("expense: add 'Hotel' 1000 SEK, paid by Ada, split all", async () => {
    await page.getByLabel("What was it for?").fill("Hotel");
    await page.getByLabel("Amount").fill("1000");
    await page.getByLabel("Who paid?").selectOption({ label: "Ada" });
    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(`**${groupUrl}`);
  });

  await test.step("payment: new form", async () => {
    await page.goto(`${groupUrl}/betalningar/ny`);
    await checkPage(page, "payment: new form");
  });

  await test.step("payment: register Bo -> Ada 200 SEK", async () => {
    await page.getByLabel("Who paid?").selectOption({ label: "Bo" });
    await page.getByLabel("Who received it?").selectOption({ label: "Ada" });
    await page.getByLabel("Amount").fill("200");
    await page.getByRole("button", { name: "Save payment" }).click();
    await page.waitForURL(`**${groupUrl}`);
  });

  await test.step("group dashboard (with recent activity)", async () => {
    await page.goto(groupUrl);
    await checkPage(page, "dashboard: with activity");
  });

  await test.step("activity feed (relative dates: today)", async () => {
    await page.goto(`${groupUrl}/aktivitet`);
    await expect(page.getByText("Today")).toBeVisible();
    await checkPage(page, "activity");
  });

  await test.step("settle up", async () => {
    await page.goto(`${groupUrl}/gor-upp`);
    await checkPage(page, "settle");
    const detailsToggle = page.getByRole("button", { name: "Details" });
    if (await detailsToggle.isVisible()) {
      await detailsToggle.click();
      await checkPage(page, "settle: details table");
    }
  });

  await test.step("participants: list", async () => {
    await page.goto(`${groupUrl}/deltagare`);
    await checkPage(page, "participants: list");
  });

  await test.step("participants: rename dialog + validation error", async () => {
    // Scope to <main> — the session-rail sidebar nav also renders an <li> per participant
    // (without a Rename button), and an unscoped "li" locator can match that one first.
    const row = page.locator("main li", { hasText: "Ada" }).first();
    await row.getByRole("button", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await checkPage(page, "participants: rename dialog");

    // Same native-`required`-vs-server-trim reasoning as the /new form above.
    await dialog.getByLabel("New name").fill(" ");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("A name is required.")).toBeVisible();
    await checkPage(page, "participants: rename validation error");
    await page.keyboard.press("Escape");
  });

  await test.step("expense: detail + edit form", async () => {
    await page.goto(groupUrl);
    await page.getByRole("link", { name: "Hotel" }).click();
    await checkPage(page, "expense: detail");

    await page.getByRole("link", { name: "Edit" }).click();
    await checkPage(page, "expense: edit form");
  });

  await test.step("payment: detail + edit form", async () => {
    await page.goto(`${groupUrl}/aktivitet`);
    // The payment row links to its detail page; find it by its title (payment.detailTitle).
    await page.getByRole("link", { name: "Payment" }).first().click();
    await checkPage(page, "payment: detail");

    await page.getByRole("link", { name: "Edit" }).click();
    await checkPage(page, "payment: edit form");
  });

  await test.step("admin: elevated actions page (the creator is admin right after creation)", async () => {
    await page.goto(`${groupUrl}/admin`);
    await checkPage(page, "admin: elevated actions page");
  });

  await test.step("admin: key-entry form (a plain member is not admin)", async () => {
    await memberPage.goto(`${groupUrl}/admin`);
    await checkPage(memberPage, "admin: key-entry form");
    await memberContext.close();
  });

  await test.step("admin: change-group-key confirm dialog", async () => {
    await page.getByRole("button", { name: "Change group key" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await checkPage(page, "admin: change-group-key dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("admin: change-admin-key confirm dialog", async () => {
    await page.getByRole("button", { name: "Change admin key" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await checkPage(page, "admin: change-admin-key dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("admin: delete-group confirm dialog", async () => {
    await page.getByRole("button", { name: "Delete group" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await checkPage(page, "admin: delete-group dialog");
    // Type the wrong name to exercise the mismatch copy too, without ever confirming.
    await dialog.getByLabel(`Type "${groupName}" to confirm`).fill("wrong name");
    await checkPage(page, "admin: delete-group dialog (name typed)");
    await page.keyboard.press("Escape");
  });

  await test.step("invite dialog", async () => {
    await page.goto(groupUrl);
    await page.getByRole("button", { name: "Invite" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkPage(page, "invite dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("leave-group dialog", async () => {
    await page.getByRole("button", { name: "Leave group" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkPage(page, "leave-group dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("my groups page + its leave confirmation", async () => {
    await page.goto("/mina-grupper");
    await expect(page.getByRole("heading", { name: "My groups" })).toBeVisible();
    await checkPage(page, "my groups");
    await page.getByRole("button", { name: /^Leave / }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await checkPage(page, "my groups: leave confirm dialog");
    await page.keyboard.press("Escape");
  });

  await test.step("unknown URL (404)", async () => {
    await page.goto("/this-route-does-not-exist");
    await checkPage(page, "404 page");
  });

  expect(leaks, leaks.join("\n")).toEqual([]);

  await context.close();
});

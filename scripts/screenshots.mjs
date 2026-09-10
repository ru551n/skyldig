/**
 * Captures interface screenshots of the whole create → expense → settle → activity flow,
 * plus the invite dialog and a foreign-currency expense (to show the exchange-rate caption).
 *
 * Usage: node scripts/screenshots.mjs [baseUrl] [locale] [outDir]
 *   baseUrl  base URL of a running server (default http://localhost:3210)
 *   locale   "sv" (default) or "en" — selects both the UI locale (via Accept-Language,
 *            which the app's resolveLocale() reads before any cookie is set) and the
 *            button/link text this script looks for
 *   outDir   output directory (default docs/screenshots/ for sv, docs/screenshots/en/ for en)
 *
 * Examples:
 *   node scripts/screenshots.mjs
 *   node scripts/screenshots.mjs http://localhost:3210 en
 *   node scripts/screenshots.mjs http://localhost:3210 en docs/screenshots/en/
 *
 * Requires a running server and database.
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3210";
const LOCALE = process.argv[3] === "en" ? "en" : "sv";
const DEFAULT_OUT = LOCALE === "en" ? "../docs/screenshots/en/" : "../docs/screenshots/";
const OUT = process.argv[4]
  ? process.argv[4].replace(/\/?$/, "/")
  : new URL(DEFAULT_OUT, import.meta.url).pathname;
const errors = [];

// Text this script looks for in each locale, matching app/i18n/sv.ts and app/i18n/en.ts.
const TXT =
  LOCALE === "en"
    ? {
        createSessionLink: /Create a group/i,
        addParticipant: /Add participant/i,
        createSubmit: /Create group|Create/i,
        goToSession: /Go to group/i,
        ackAdminKey: /I have saved the admin key/i,
        inviteAction: /Invite/i,
        saveExpense: /Save expense/i,
        savePayment: /Save payment|Save/i,
      }
    : {
        createSessionLink: /Skapa grupp/i,
        addParticipant: /Lägg till deltagare/i,
        createSubmit: /Skapa grupp|Skapa/i,
        goToSession: /Till gruppen|Öppna gruppen/i,
        ackAdminKey: /Jag har sparat adminnyckeln/i,
        inviteAction: /Bjud in/i,
        saveExpense: /Spara utgift/i,
        savePayment: /Spara betalning|Spara/i,
      };

const browser = await chromium.launch();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: LOCALE === "en" ? "en-GB" : "sv-SE",
});
const p = await mobile.newPage();
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));

const shot = (name, page = p) =>
  page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

await p.goto(BASE);
await p.waitForLoadState("networkidle");
await shot("01-landing");

await p.getByRole("link", { name: TXT.createSessionLink }).click();
await p.waitForLoadState("networkidle");
await p.locator('input[name="name"]').fill("Japan 2026");
const parts = p.locator('input[name="participant"]');
const count = await parts.count();
await parts.nth(0).fill("Anna");
if (count > 1) await parts.nth(1).fill("Johan");
const addBtn = p.getByRole("button", { name: TXT.addParticipant });
if (await addBtn.count()) {
  await addBtn.click();
  await p.locator('input[name="participant"]').nth(2).fill("Peter");
}
await shot("02-create");
// The create action rejects submissions faster than 1.5s after the form rendered (a min-
// time-on-page anti-bot check — see new.tsx's `verifyFormToken`), so pace ourselves.
await p.waitForTimeout(1700);
await p.getByRole("button", { name: TXT.createSubmit }).last().click();
await p.waitForLoadState("networkidle");
await p.waitForTimeout(600);
await shot("03-keys");

await p.getByLabel(TXT.ackAdminKey).check();
await p.getByRole("button", { name: TXT.goToSession }).click();
await p.waitForLoadState("networkidle");
const sid = new URL(p.url()).pathname.split("/")[2];

// Invite dialog — QR code + one-time link, opened from the mobile header button.
await p.getByRole("button", { name: TXT.inviteAction }).click();
await p.getByRole("dialog").waitFor({ state: "visible" });
await p.waitForTimeout(600);
await shot("11-invite");
await p.keyboard.press("Escape");
await p.getByRole("dialog").waitFor({ state: "hidden" }).catch(() => {});

async function addExpense(what, amount, currency, screenshotName) {
  await p.goto(`${BASE}/s/${sid}/utgifter/ny`);
  await p.waitForLoadState("networkidle");
  await p.locator('input[name="description"]').fill(what);
  if (currency) {
    await p.locator("#currencyCode").selectOption(currency);
  }
  await p.locator('input[name="amountText"]').fill(amount);
  // Give the live exchange-rate lookup (or the last-used-rate fallback) a moment to resolve.
  await p.waitForTimeout(currency ? 1200 : 500);
  if (screenshotName) await shot(screenshotName);
  await p.getByRole("button", { name: TXT.saveExpense }).click();
  await p.waitForURL(`${BASE}/s/${sid}`, { timeout: 15000 }).catch(async () => {
    const alerts = await p.locator('[role="alert"]').allInnerTexts();
    throw new Error(
      `Expense "${what}" was not saved (still at ${p.url()})${alerts.length ? `: ${alerts.join(" / ")}` : ""}`,
    );
  });
}

// Foreign-currency expense so the form shows the exchange-rate caption ("Dagens kurs" /
// "senast använda kursen" — see RateSection.tsx); falls back gracefully if the live rate
// lookup is unavailable, the caption is just omitted or shows the last-used-rate wording.
await addExpense("Hotell i Tokyo", "1200", "JPY", "04-expense-form");
await addExpense("Middag och drinkar", "640", null, null);

await p.goto(`${BASE}/s/${sid}/betalningar/ny`);
await p.waitForLoadState("networkidle");
await p.locator('input[name="amountText"]').fill("200");
const recipient = p.locator('select[name="recipientPublicId"]');
for (const opt of await recipient.locator("option").all()) {
  const value = await opt.getAttribute("value");
  const disabled = await opt.isDisabled();
  if (value && !disabled) {
    await recipient.selectOption(value);
    break;
  }
}
await p.getByRole("button", { name: TXT.savePayment }).last().click();
// The form submits via fetch, so wait for the client-side navigation, not the network.
await p.waitForURL(`${BASE}/s/${sid}`, { timeout: 15000 }).catch(async () => {
  const alerts = await p.locator('[role="alert"]').allInnerTexts();
  throw new Error(
    `Payment was not saved (still at ${p.url()})${alerts.length ? `: ${alerts.join(" / ")}` : ""}`,
  );
});

for (const [path, name] of [
  ["", "05-dashboard"],
  ["/gor-upp", "06-settle"],
  ["/aktivitet", "07-activity"],
  ["/deltagare", "08-participants"],
]) {
  await p.goto(`${BASE}/s/${sid}${path}`);
  // Bypass any cached document so the screenshot reflects committed state.
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  await shot(name);
}

const desktop = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  locale: LOCALE === "en" ? "en-GB" : "sv-SE",
  storageState: await mobile.storageState(),
});
const d = await desktop.newPage();
for (const [path, name] of [
  ["", "09-dashboard-desktop"],
  ["/gor-upp", "10-settle-desktop"],
]) {
  await d.goto(`${BASE}/s/${sid}${path}`);
  await d.reload({ waitUntil: "networkidle" });
  await d.waitForTimeout(700);
  await d.screenshot({ path: `${OUT}${name}.png` });
}

await browser.close();
console.log("locale:", LOCALE, "outDir:", OUT);
console.log("session:", sid);
console.log("console errors:", errors.length ? errors.slice(0, 5) : "none");

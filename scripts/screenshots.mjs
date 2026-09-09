/**
 * Captures interface screenshots into docs/screenshots.
 * Usage: node scripts/screenshots.mjs [baseUrl]
 * Requires a running server and database.
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3210";
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname;
const errors = [];

const browser = await chromium.launch();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "sv-SE",
});
const p = await mobile.newPage();
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));

const shot = (name, page = p) =>
  page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });

await p.goto(BASE);
await p.waitForLoadState("networkidle");
await shot("01-landing");

await p.getByRole("link", { name: /Skapa grupp/i }).click();
await p.waitForLoadState("networkidle");
await p.locator('input[name="name"]').fill("Japan 2026");
const parts = p.locator('input[name="participant"]');
const count = await parts.count();
await parts.nth(0).fill("Anna");
if (count > 1) await parts.nth(1).fill("Johan");
const addBtn = p.getByRole("button", { name: /Lägg till deltagare/i });
if (await addBtn.count()) {
  await addBtn.click();
  await p.locator('input[name="participant"]').nth(2).fill("Peter");
}
await shot("02-create");
await p.getByRole("button", { name: /Skapa grupp|Skapa/i }).last().click();
await p.waitForLoadState("networkidle");
await p.waitForTimeout(600);
await shot("03-keys");

await p.getByRole("link", { name: /Till gruppen|Öppna gruppen/i }).click();
await p.waitForLoadState("networkidle");
const sid = new URL(p.url()).pathname.split("/")[2];

async function addExpense(what, amount, screenshotName) {
  await p.goto(`${BASE}/s/${sid}/utgifter/ny`);
  await p.waitForLoadState("networkidle");
  await p.locator('input[name="description"]').fill(what);
  await p.locator('input[name="amountText"]').fill(amount);
  await p.waitForTimeout(500);
  if (screenshotName) await shot(screenshotName);
  await p.getByRole("button", { name: /Spara utgift/i }).click();
  await p.waitForURL(`${BASE}/s/${sid}`, { timeout: 15000 }).catch(async () => {
    const alerts = await p.locator('[role="alert"]').allInnerTexts();
    throw new Error(
      `Expense "${what}" was not saved (still at ${p.url()})${alerts.length ? `: ${alerts.join(" / ")}` : ""}`,
    );
  });
}

await addExpense("Hotell i Tokyo", "1200", "04-expense-form");
await addExpense("Middag och drinkar", "640", null);

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
await p.getByRole("button", { name: /Spara betalning|Spara/i }).last().click();
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
  locale: "sv-SE",
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
console.log("session:", sid);
console.log("console errors:", errors.length ? errors.slice(0, 5) : "none");

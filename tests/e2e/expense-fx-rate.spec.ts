import { expect, test } from "@playwright/test";

/**
 * Covers the automatic exchange-rate suggestion feature (docs/architecture.md §5.1): the rate
 * field is PREFILLED from a live daily rate, never used to silently compute anything — the
 * user can see it, edit it, or ignore it, and the same manual `parseRate`/`convertToBase` path
 * processes whatever ends up in the field at submit time.
 *
 * Makes a real call to the live Frankfurter API (api.frankfurter.app) rather than mocking it:
 * the lookup happens server-side (in the page loader / the `fx-rate` resource route), which
 * Playwright's browser-side `page.route` interception cannot reach, and this repo has no
 * server-side network-mocking infra to match (see `server/modules/fx/rate-provider.test.ts`
 * for the mocked-fetch unit coverage of the provider itself). EUR/SEK is one of Frankfurter's
 * ~30 supported currencies; KWD is one of the four (VND, KWD, BHD, TND) Skyldig supports that
 * Frankfurter does not.
 */

async function createGroup(page: import("@playwright/test").Page) {
  await page.goto("/new");
  await page.getByLabel("Namn på gruppen").fill("FX Rate Test");
  await page.getByLabel("Valuta").selectOption("SEK");

  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Anna");
  await participantInputs.nth(1).fill("Johan");

  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();

  const sessionLink = page.getByRole("link", { name: "Till gruppen" });
  const href = await sessionLink.getAttribute("href");
  const groupUrl = href!;
  await sessionLink.click();
  await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));
  return groupUrl;
}

test.describe.configure({ mode: "serial" });

// Set explicitly for a verification run (`FX_RATE_LOOKUP_ENABLED=false pnpm exec playwright
// test`) to prove the app stays fully functional with live lookups off — see
// docs/architecture.md §5.1 ("must work with zero external calls"). When disabled, the live
// prefill assertions below don't apply (there's nothing to prefill from, and no prior session
// rate either), so this spec checks the field stays empty instead.
const fxLookupDisabled = process.env.FX_RATE_LOOKUP_ENABLED === "false";

test("live daily rate prefills the field for a supported currency, stays empty for an unsupported one, and manual entry still submits", async ({
  page,
}) => {
  const groupUrl = await createGroup(page);

  await test.step("selecting a foreign, Frankfurter-supported currency (EUR) prefills the rate field (or stays empty when lookups are disabled)", async () => {
    await page.goto(`${groupUrl}/utgifter/ny`);
    await page.getByLabel("Vad gällde det?").fill("Middag");
    await page.getByLabel("Belopp").fill("90");

    await page.locator("#currencyCode").selectOption("EUR");

    const rateInput = page.locator("#rateText");
    await expect(rateInput).toBeVisible();

    if (fxLookupDisabled) {
      await page.waitForTimeout(2000);
      await expect(rateInput).toHaveValue("");
      await expect(page.getByText("Dagens kurs")).not.toBeVisible();
    } else {
      // The session has no prior EUR rate, so any non-empty value here can only have come
      // from the live Frankfurter lookup, not the "last used in session" fallback.
      await expect(rateInput).not.toHaveValue("", { timeout: 10_000 });
      const value = await rateInput.inputValue();
      expect(Number(value.replace(",", "."))).toBeGreaterThan(0);
      await expect(page.getByText("Dagens kurs")).toBeVisible();
    }
  });

  await test.step("switching to a currency Frankfurter doesn't support (KWD) leaves the field empty and editable", async () => {
    await page.locator("#currencyCode").selectOption("KWD");

    const rateInput = page.locator("#rateText");
    await expect(rateInput).toBeVisible();
    // Give any in-flight lookup time to resolve, then confirm it never fills the field.
    await page.waitForTimeout(2000);
    await expect(rateInput).toHaveValue("");
    await expect(rateInput).toBeEditable();
  });

  await test.step("the form still submits successfully with a manually typed rate", async () => {
    const rateInput = page.locator("#rateText");
    await rateInput.fill("0.35");
    await page.getByLabel("Vem betalade?").selectOption({ label: "Anna" });
    await page.getByRole("button", { name: "Markera alla", exact: true }).click();

    await page.getByRole("button", { name: "Spara utgift" }).click();
    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));
    await expect(page.getByRole("link", { name: "Middag" })).toBeVisible();
  });
});

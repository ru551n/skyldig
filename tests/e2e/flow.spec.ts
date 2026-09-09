import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end MVP flow, steps 1-12 from the task: create a group, add
 * participants, add expenses in two currencies, register a repayment, edit
 * an expense, inspect history, verify balances and the settlement plan,
 * then leave and rejoin. Written as ONE test with test.step()s sharing a
 * single `page` (and therefore browser context / session cookie) because
 * each step depends on the browser session established by the previous
 * one — a fresh Playwright test gets a fresh context, which would drop the
 * group membership cookie between steps.
 */

async function setChip(page: Page, groupLabel: string, name: string, on: boolean) {
  const group = page.getByRole("group", { name: groupLabel });
  const chip = group.getByRole("button", { name, exact: true });
  const pressed = await chip.getAttribute("aria-pressed");
  if ((pressed === "true") !== on) {
    await chip.click();
  }
}

/** Parses a Swedish-formatted kr string like "1 200,00 kr" or "−225,00 kr" into a number. */
function parseSvKr(text: string): number {
  const cleaned = text
    .replace(/−/g, "-")
    .replace(/kr/gi, "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

test.describe.configure({ mode: "serial" });

test("full MVP flow: create, expenses, payment, edit, history, balances, settle, leave, rejoin", async ({ page }) => {
  let groupUrl = "";
  let phrase = "";
  let adminKey = "";
  const nets: Record<string, number> = {};

  await test.step("1. create a group with participants Anna, Johan, Peter", async () => {
    await page.goto("/new");
    await page.getByLabel("Namn på gruppen").fill("Japan 2026");
    await page.getByLabel("Valuta").selectOption("SEK");

    const participantInputs = page.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Anna");
    await participantInputs.nth(1).fill("Johan");
    await page.getByRole("button", { name: "Lägg till deltagare" }).click();
    await page.locator('input[name="participant"]').nth(2).fill("Peter");

    await page.getByRole("button", { name: "Skapa grupp" }).click();
    await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  });

  await test.step("2. capture the phrase and admin key and validate their shape", async () => {
    const phraseText = (await page.locator("p.tabular.select-all").first().innerText()).trim();
    const adminKeyText = (await page.locator("p.tabular.select-all").nth(1).innerText()).trim();

    const words = phraseText.split("-");
    expect(words).toHaveLength(6);
    for (const w of words) {
      expect(w).toMatch(/^[a-zåäö]+$/);
    }

    expect(adminKeyText.startsWith("admin-")).toBe(true);

    // Visually separated: the phrase sits in a plain bordered card, the admin key in a
    // distinct rust-bordered warning card — two different container elements.
    const phraseCard = page.locator("p.tabular.select-all").first().locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
    const adminCard = page.locator("p.tabular.select-all").nth(1).locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
    await expect(adminCard).toHaveClass(/border-rust/);
    await expect(phraseCard).not.toHaveClass(/border-rust/);

    phrase = phraseText;
    adminKey = adminKeyText;

    const sessionLink = page.getByRole("link", { name: "Till gruppen" });
    const href = await sessionLink.getAttribute("href");
    expect(href).toMatch(/^\/s\/[a-z0-9]+$/);
    groupUrl = href!;

    await sessionLink.click();
    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));
  });

  await test.step("3. add Maria; reject duplicate name with different case", async () => {
    await page.goto(`${groupUrl}/deltagare`);

    await page.getByLabel("Namn").fill("Maria");
    await page.getByRole("button", { name: "Lägg till", exact: true }).click();
    // Scoped to <main>: on desktop viewports the participant also appears in the sticky
    // session rail (a second "Maria" text node), so an unscoped getByText is ambiguous.
    await expect(page.locator("main").getByText("Maria")).toBeVisible();

    await page.getByLabel("Namn").fill("anna");
    await page.getByRole("button", { name: "Lägg till", exact: true }).click();
    await expect(page.getByText("Det finns redan en deltagare med det namnet")).toBeVisible();
  });

  await test.step("4. add Hotell: 1200 SEK, paid by Johan, split Johan/Anna/Peter", async () => {
    await page.goto(`${groupUrl}/utgifter/ny`);

    await page.getByLabel("Vad gällde det?").fill("Hotell");
    await page.getByLabel("Belopp").fill("1200");
    await page.getByLabel("Vem betalade?").selectOption({ label: "Johan" });

    await page.getByRole("button", { name: "Markera alla", exact: true }).click();
    await setChip(page, "Vilka delar på utgiften?", "Maria", false);
    await setChip(page, "Vilka delar på utgiften?", "Johan", true);
    await setChip(page, "Vilka delar på utgiften?", "Anna", true);
    await setChip(page, "Vilka delar på utgiften?", "Peter", true);

    await test.step("preview shows 400,00 kr per person before saving", async () => {
      const preview = page.getByText("Så här delas det").locator("xpath=ancestor::div[1]");
      const rows = preview.locator("li");
      await expect(rows).toHaveCount(3);
      for (const name of ["Johan", "Anna", "Peter"]) {
        await expect(preview.locator("li", { hasText: name })).toContainText("400,00 kr");
      }
    });

    await page.getByRole("button", { name: "Spara utgift" }).click();
    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

    await test.step("saved expense detail shows the same three shares", async () => {
      await page.getByRole("link", { name: "Hotell" }).click();
      await expect(page.getByRole("heading", { name: "Hotell" })).toBeVisible();
      const sharesSection = page.getByText("Så här delas det").locator("xpath=ancestor::section[1]");
      for (const name of ["Johan", "Anna", "Peter"]) {
        await expect(sharesSection.locator("div", { hasText: name }).last()).toContainText("400,00 kr");
      }
    });
  });

  await test.step("5. add Middag: 90 EUR, paid by Anna, split all four, with a rate", async () => {
    await page.goto(`${groupUrl}/utgifter/ny`);

    const rate = 10; // 1 EUR = 10 SEK
    const amountEur = 90;
    const expectedBaseKr = (amountEur * rate).toFixed(2).replace(".", ",");

    await page.getByLabel("Vad gällde det?").fill("Middag");
    await page.getByLabel("Belopp").fill(String(amountEur));
    await page.locator("#currencyCode").selectOption("EUR");
    await page.getByLabel("Vem betalade?").selectOption({ label: "Anna" });
    await page.getByRole("button", { name: "Markera alla", exact: true }).click();

    const rateInput = page.locator("#rateText");
    await expect(rateInput).toBeVisible();
    await rateInput.fill(String(rate));

    await page.getByRole("button", { name: "Spara utgift" }).click();
    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

    await page.getByRole("link", { name: "Middag" }).click();
    await expect(page.getByRole("heading", { name: "Middag" })).toBeVisible();
    await expect(page.getByText(`≈ ${expectedBaseKr} kr`)).toBeVisible();
  });

  await test.step("6. add a repayment: Anna pays Johan 500 SEK, visible in activity", async () => {
    await page.goto(`${groupUrl}/betalningar/ny`);
    await page.getByLabel("Vem betalade?").selectOption({ label: "Anna" });
    await page.getByLabel("Vem fick betalningen?").selectOption({ label: "Johan" });
    await page.getByLabel("Belopp").fill("500");
    await page.getByRole("button", { name: "Spara betalning" }).click();
    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

    await page.goto(`${groupUrl}/aktivitet`);
    await expect(page.getByText("Anna").first()).toBeVisible();
    await expect(page.getByText(/500,00\s*kr/).first()).toBeVisible();
  });

  await test.step("7. edit Hotell: amount to 1500, remove Peter from the split", async () => {
    await page.goto(`${groupUrl}`);
    await page.getByRole("link", { name: "Hotell" }).click();
    await page.getByRole("link", { name: "Ändra" }).click();

    await page.getByLabel("Belopp").fill("1500");
    await setChip(page, "Vilka delar på utgiften?", "Peter", false);

    await test.step("preview shows 750,00 kr each for the two remaining", async () => {
      const preview = page.getByText("Så här delas det").locator("xpath=ancestor::div[1]");
      const rows = preview.locator("li");
      await expect(rows).toHaveCount(2);
      for (const name of ["Johan", "Anna"]) {
        await expect(preview.locator("li", { hasText: name })).toContainText("750,00 kr");
      }
    });

    await page.getByRole("button", { name: "Spara utgift" }).click();
    await expect(page.getByRole("heading", { name: "Hotell" })).toBeVisible();

    const sharesSection = page.getByText("Så här delas det").locator("xpath=ancestor::section[1]");
    await expect(sharesSection.getByText("Peter")).toHaveCount(0);
    for (const name of ["Johan", "Anna"]) {
      await expect(sharesSection.locator("div", { hasText: name }).last()).toContainText("750,00 kr");
    }
  });

  await test.step("8. Hotell history lists the creation and the edit with what changed", async () => {
    await page.goto(`${groupUrl}`);
    await page.getByRole("link", { name: "Hotell" }).click();

    const history = page.getByText("Historik").locator("xpath=ancestor::section[1]");
    const entries = history.locator("ol > li");
    await expect(entries).toHaveCount(2);

    await expect(entries.nth(0)).toContainText("Skapad");
    await expect(entries.nth(1)).toContainText("Ändrad");
    await expect(entries.nth(1)).toContainText("1 200,00 kr");
    await expect(entries.nth(1)).toContainText("1 500,00 kr");
    await expect(entries.nth(1)).toContainText("Borttagna");
    await expect(entries.nth(1)).toContainText("Peter");
  });

  await test.step("9. verify balances on the settle screen's detail table", async () => {
    await page.goto(`${groupUrl}/gor-upp`);
    await page.getByRole("button", { name: "Detaljer" }).click();

    const table = page.locator("table");
    await expect(table).toBeVisible();

    // Expected, computed from the domain formula net = paid - share + repaid - received:
    //   Anna:  paid 900 (Middag), share 750(Hotell)+225(Middag)=975, repaid 500, received 0 -> 900-975+500 = 425
    //   Johan: paid 1500 (Hotell), share 750+225=975, repaid 0, received 500              -> 1500-975-500 = 25
    //   Peter: paid 0, share 225 (Middag only, removed from Hotell)                        -> -225
    //   Maria: paid 0, share 225 (Middag only)                                             -> -225
    const expectedNet: Record<string, number> = { Anna: 425, Johan: 25, Peter: -225, Maria: -225 };

    for (const [name, expected] of Object.entries(expectedNet)) {
      const row = table.locator("tr", { hasText: name });
      const netCell = row.locator("td").last();
      const value = parseSvKr((await netCell.innerText()).trim());
      expect(value).toBeCloseTo(expected, 2);
      nets[name] = value;
    }

    const sum = Object.values(nets).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThan(0.005);
  });

  await test.step("10. verify the settlement plan clears the balances", async () => {
    await page.goto(`${groupUrl}/gor-upp`);

    const payRows = page.locator("main p", { hasText: " betalar " });
    const rowCount = await payRows.count();
    expect(rowCount).toBeGreaterThan(0);

    const applied = { ...nets };
    for (let i = 0; i < rowCount; i++) {
      const row = payRows.nth(i);
      const text = (await row.innerText()).trim();
      const match = /^(.+?) betalar (.+)$/.exec(text);
      expect(match).not.toBeNull();
      const from = match![1]!.trim();
      const to = match![2]!.trim();
      expect(from).not.toBe(to);

      // The transfer amount is the tabular money span within the same settle row.
      const rowContainer = row.locator("xpath=ancestor::*[contains(@class,'rounded-row') or contains(@class,'sol')][1]");
      const amountText = await rowContainer.locator(".tabular").last().innerText();
      const amount = parseSvKr(amountText);
      expect(amount).toBeGreaterThan(0);

      expect(applied[from]).toBeDefined();
      expect(applied[to]).toBeDefined();
      applied[from]! += amount;
      applied[to]! -= amount;
    }

    for (const [name, net] of Object.entries(applied)) {
      expect(Math.abs(net), `net for ${name} should be cleared`).toBeLessThan(0.01);
    }
  });

  await test.step("11. leave the group via 'Lämna gruppen'", async () => {
    await page.goto(`${groupUrl}`);
    await page.getByRole("button", { name: "Lämna gruppen" }).click();
    // ConfirmDialog: the dialog's own confirm button carries the same label.
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Lämna gruppen" }).click();

    await expect(page).toHaveURL(/\/\?lamnad=1$/);

    await test.step("navigating back to the group URL no longer shows the group", async () => {
      await page.goto(`${groupUrl}`);
      await expect(page.getByText("Gruppen finns inte, eller så har du inte tillgång till den.")).toBeVisible();
    });
  });

  await test.step("12. join again with the phrase (spaces, mixed case); prior data is intact", async () => {
    const spaced = phrase.split("-").join(" ");
    const mixedCase = spaced
      .split(" ")
      .map((w, i) => (i % 2 === 0 ? w.toUpperCase() : w))
      .join(" ");

    await page.goto("/join");
    await page.getByLabel("Gruppnyckel").fill(mixedCase);
    await page.getByRole("button", { name: "Gå med" }).click();

    await expect(page).toHaveURL(new RegExp(`${groupUrl}$`));

    await expect(page.getByText("Hotell")).toBeVisible();
    await expect(page.getByText("Middag")).toBeVisible();

    await page.goto(`${groupUrl}/gor-upp`);
    const payRows = page.locator("main p", { hasText: " betalar " });
    expect(await payRows.count()).toBeGreaterThan(0);
  });

  // adminKey is captured (step 2) but exercised in admin.spec.ts, not here.
  void adminKey;
});

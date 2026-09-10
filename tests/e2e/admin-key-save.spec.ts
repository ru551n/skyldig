import { expect, test, type Page } from "@playwright/test";

/**
 * Keeping the unrecoverable admin key: an explicit save to the password manager (Credential
 * Management API) and the system share sheet, each shown only where the browser supports it,
 * plus an Admin unlock form marked up so password managers can file and fill the key.
 *
 * Browser support is stubbed in an init script so these run the same on any CI browser; the
 * real save prompt and share sheet are browser UI no automated test can drive.
 */

// Own rate-limit identity (the e2e server trusts the loopback hop), so this file's group
// creation doesn't spend the budget the rest of the suite shares.
const HEADERS = { "Accept-Language": "sv-SE,sv;q=0.9", "X-Forwarded-For": "198.51.100.19" };
test.use({ extraHTTPHeaders: HEADERS });

async function stubBrowserSupport(page: Page, { store, share }: { store: boolean; share: boolean }) {
  await page.addInitScript(
    ({ store, share }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__stored = [];
      w.__shared = [];
      if (store) {
        w.PasswordCredential = class {
          constructor(public data: Record<string, string>) {}
        };
        Object.defineProperty(navigator, "credentials", {
          configurable: true,
          value: { store: async (cred: { data: unknown }) => (w.__stored as unknown[]).push(cred.data) },
        });
      } else {
        delete w.PasswordCredential;
      }
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: share ? async (data: unknown) => (w.__shared as unknown[]).push(data) : undefined,
      });
    },
    { store, share },
  );
}

async function createGroup(page: Page) {
  await page.goto("/new");
  await page.locator('input[name="name"]').fill("Stugresa");
  const participantInputs = page.locator('input[name="participant"]');
  await participantInputs.nth(0).fill("Ada");
  await participantInputs.nth(1).fill("Bo");
  // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
  await page.waitForTimeout(1_600);
  await page.getByRole("button", { name: "Skapa grupp" }).click();
  await expect(page.getByText("Gruppen är skapad")).toBeVisible();
  const [phrase, adminKey] = await page.locator("p.tabular.select-all").allInnerTexts();
  const action = await page.locator('form[action^="/s/"]').getAttribute("action");
  const publicId = action!.split("/")[2]!;
  return { phrase: phrase!.trim(), adminKey: adminKey!.trim(), publicId };
}

test("the creation page saves the admin key to the password manager and shares it, where supported", async ({ page, browser }) => {
  await stubBrowserSupport(page, { store: true, share: true });
  const { phrase, adminKey, publicId } = await createGroup(page);

  await test.step("saves under a per-group username", async () => {
    await page.getByRole("button", { name: "Spara i lösenordshanteraren" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __stored: unknown[] }).__stored)).toEqual([
      { id: `Stugresa (${publicId})`, password: adminKey, name: "Skyldig – Stugresa" },
    ]);
  });

  await test.step("shares the key with a warning to send it only to yourself", async () => {
    await expect(page.getByText("Skicka den bara till dig själv")).toBeVisible();
    await page.getByRole("button", { name: "Dela adminnyckeln" }).click();
    const shared = await page.evaluate(() => (window as unknown as { __shared: { text: string }[] }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.text).toContain(adminKey);
  });

  await test.step("the Admin unlock form is marked up for password managers", async () => {
    // A second browser that joined with the group key is a member, so Admin shows the unlock form.
    const context = await browser.newContext({ extraHTTPHeaders: HEADERS });
    const member = await context.newPage();
    await member.goto("/join");
    await member.getByLabel("Gruppnyckel").fill(phrase.split("-").join(" "));
    await member.getByRole("button", { name: "Gå med" }).click();
    await expect(member).toHaveURL(/\/s\/[a-z0-9]+$/);
    await member.goto(`/s/${publicId}/admin`);

    const keyField = member.locator('input[name="adminKey"]');
    await expect(keyField).toHaveAttribute("type", "password");
    await expect(keyField).toHaveAttribute("autocomplete", "current-password");
    const username = member.locator('input[autocomplete="username"]');
    await expect(username).toHaveValue(`Stugresa (${publicId})`);
    await expect(username).not.toHaveAttribute("name", /.+/);

    await keyField.fill(adminKey);
    await member.getByRole("button", { name: "Lås upp" }).click();
    await expect(member.locator('input[name="adminKey"]')).toHaveCount(0);
    await context.close();
  });
});

test("neither button appears where the browser supports neither", async ({ page }) => {
  await stubBrowserSupport(page, { store: false, share: false });
  await createGroup(page);
  await expect(page.getByRole("button", { name: "Kopiera" }).nth(1)).toBeVisible();
  await expect(page.getByRole("button", { name: "Spara i lösenordshanteraren" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dela adminnyckeln" })).toHaveCount(0);
});

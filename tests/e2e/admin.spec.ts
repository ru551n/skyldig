import { expect, test } from "@playwright/test";

/**
 * Admin flow: a member joining with just the access phrase must elevate with
 * the admin key before seeing admin actions; wrong keys fail generically;
 * rotating the phrase invalidates the old one; deleting requires typing the
 * group's name and removes the group entirely.
 *
 * Uses two browser contexts on purpose: `creatorPage`'s context is the one
 * that created the group (already admin, per app/routes/new.tsx granting
 * the creator's browser session the "admin" role) and is only used to
 * obtain the phrase/admin key; all the actual admin-flow assertions happen
 * from `memberPage`, a fresh context that joins as a plain member.
 */

test.describe.configure({ mode: "serial" });

test("admin: elevate, wrong key, rotate phrase, delete group", async ({ browser }) => {
  const creatorContext = await browser.newContext();
  const creatorPage = await creatorContext.newPage();

  let groupUrl = "";
  let groupName = "";
  let phrase = "";
  let adminKey = "";

  await test.step("create a group to obtain a phrase and admin key", async () => {
    await creatorPage.goto("/new");
    groupName = "Admin Test Group";
    await creatorPage.getByLabel("Namn på gruppen").fill(groupName);
    const participantInputs = creatorPage.locator('input[name="participant"]');
    await participantInputs.nth(0).fill("Sven");
    await participantInputs.nth(1).fill("Lisa");
    // Past the anti-bot minimum-time-on-page threshold (server/modules/auth/form-token.ts).
    await creatorPage.waitForTimeout(1_600);
    await creatorPage.getByRole("button", { name: "Skapa grupp" }).click();
    await expect(creatorPage.getByText("Gruppen är skapad")).toBeVisible();

    phrase = (await creatorPage.locator("p.tabular.select-all").first().innerText()).trim();
    adminKey = (await creatorPage.locator("p.tabular.select-all").nth(1).innerText()).trim();
    await creatorPage.getByLabel("Jag har sparat adminnyckeln").check();
    const href = await creatorPage.locator('form[action^="/s/"]').getAttribute("action");
    groupUrl = href!;
  });

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();

  await test.step("join as a fresh member with the phrase", async () => {
    await memberPage.goto("/join");
    await memberPage.getByLabel("Gruppnyckel").fill(phrase);
    await memberPage.getByRole("button", { name: "Gå med" }).click();
    await expect(memberPage).toHaveURL(new RegExp(`${groupUrl}$`));
  });

  await test.step("admin page shows the elevation form (not admin yet)", async () => {
    await memberPage.goto(`${groupUrl}/admin`);
    await expect(memberPage.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(memberPage.getByLabel("Adminnyckel")).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Lås upp" })).toBeVisible();
  });

  await test.step("a wrong admin key gives the generic error", async () => {
    await memberPage.getByLabel("Adminnyckel").fill("admin-totally-wrong-key-xyz");
    await memberPage.getByRole("button", { name: "Lås upp" }).click();
    await expect(memberPage.getByText("Nyckeln stämmer inte. Kontrollera stavningen och försök igen.")).toBeVisible();
    // Still not elevated: the elevation form is still there.
    await expect(memberPage.getByLabel("Adminnyckel")).toBeVisible();
  });

  await test.step("the correct admin key unlocks administrative actions", async () => {
    await memberPage.getByLabel("Adminnyckel").fill(adminKey);
    await memberPage.getByRole("button", { name: "Lås upp" }).click();
    await expect(memberPage.getByText("Du är admin för den här gruppen.")).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Byt gruppnyckel" })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Byt adminnyckel" })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Ta bort gruppen" })).toBeVisible();
  });

  let newPhrase = "";
  await test.step("rotating the access phrase invalidates the old one", async () => {
    await memberPage.getByRole("button", { name: "Byt gruppnyckel" }).click();
    const dialog = memberPage.getByRole("dialog");
    await dialog.getByRole("button", { name: "Byt gruppnyckel" }).click();

    await expect(memberPage.getByRole("heading", { name: "Ny gruppnyckel" })).toBeVisible();
    newPhrase = (await memberPage.locator("p.tabular.select-all").first().innerText()).trim();
    expect(newPhrase).not.toBe(phrase);
    expect(newPhrase.split("-")).toHaveLength(5);

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/join");
    await otherPage.getByLabel("Gruppnyckel").fill(phrase);
    await otherPage.getByRole("button", { name: "Gå med" }).click();
    await expect(otherPage.getByText("Nyckeln stämmer inte. Kontrollera stavningen och försök igen.")).toBeVisible();

    await otherPage.getByLabel("Gruppnyckel").fill(newPhrase);
    await otherPage.getByRole("button", { name: "Gå med" }).click();
    await expect(otherPage).toHaveURL(new RegExp(`${groupUrl}$`));
    await otherContext.close();
  });

  await test.step("deleting the group requires typing its name, and the URL no longer resolves", async () => {
    await memberPage.goto(`${groupUrl}/admin`);
    await memberPage.getByRole("button", { name: "Ta bort gruppen" }).click();

    const dialog = memberPage.getByRole("dialog");
    const confirmButton = dialog.getByRole("button", { name: "Ta bort gruppen permanent" });
    await expect(confirmButton).toBeDisabled();

    const confirmField = dialog.getByLabel(`Skriv "${groupName}" för att bekräfta`);
    await confirmField.fill("wrong name");
    await expect(confirmButton).toBeDisabled();

    await confirmField.fill(groupName);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(memberPage).toHaveURL(/\/$/);

    await memberPage.goto(`${groupUrl}`);
    await expect(
      memberPage.getByText("Gruppen finns inte, eller så har du inte tillgång till den."),
    ).toBeVisible();
  });

  await creatorContext.close();
  await memberContext.close();
});

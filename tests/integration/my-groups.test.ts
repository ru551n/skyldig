/**
 * "My groups" is keyed only by this browser's session cookie — there are no accounts — so it
 * must list exactly this browser's grants and never another browser's. Leaving from that page
 * returns there, and the leave route's return target is an allowlist, never a URL from the form.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createBrowserSession, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { getCookieName } from "../../server/modules/auth/cookie.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { loader } from "../../app/routes/my-groups.tsx";
import { action as leaveAction } from "../../app/routes/session/leave.tsx";
import type { Route } from "../../app/routes/+types/my-groups.ts";
import type { Route as LeaveRoute } from "../../app/routes/session/+types/leave.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function makeGroup(name: string) {
  const { session } = await createSession(db, config, {
    name,
    baseCurrency: "SEK",
    participantNames: ["Alice", "Bob"],
  });
  const [row] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.publicId, session.publicId)).limit(1);
  return { publicId: session.publicId, id: row!.id };
}

async function browserWith(...groupIds: bigint[]) {
  const browser = await db.transaction((tx) => createBrowserSession(tx));
  for (const id of groupIds) {
    await db.transaction((tx) => grantAccess(tx, browser.id, id, "member", null));
  }
  return browser.token;
}

async function load(token: string | null, query = "") {
  const headers = new Headers(token ? { cookie: `${getCookieName(config)}=${token}` } : {});
  const request = new Request(`https://skyldig.example/mina-grupper${query}`, { headers });
  return loader({ request, params: {} } as unknown as Route.LoaderArgs);
}

describe("My groups loader", () => {
  it(
    "lists this browser's groups, sorted by name, and none of another browser's",
    async () => {
      const cabin = await makeGroup("Stuga");
      const japan = await makeGroup("Japan");
      const other = await makeGroup("Någon annans grupp");
      const mine = await browserWith(cabin.id, japan.id);
      await browserWith(other.id);

      const loaded = await load(mine);
      expect(loaded.groups.map((g) => g.name)).toEqual(["Japan", "Stuga"]);
      expect(loaded.left).toBe(false);
    },
    15_000,
  );

  it("is empty without a browser session, and reports ?lamnad=1", async () => {
    const loaded = await load(null, "?lamnad=1");
    expect(loaded.groups).toEqual([]);
    expect(loaded.left).toBe(true);
  });
});

describe("leave route return target", () => {
  async function leave(returnTo: string | null) {
    const group = await makeGroup("Resa");
    const token = await browserWith(group.id);
    const body = new URLSearchParams(returnTo === null ? {} : { returnTo });
    const request = new Request(`${config.publicOrigin}/s/${group.publicId}/lamna`, {
      method: "POST",
      headers: {
        cookie: `${getCookieName(config)}=${token}`,
        origin: config.publicOrigin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const response = (await leaveAction({ request, params: { sid: group.publicId } } as unknown as LeaveRoute.ActionArgs)) as Response;
    return response.headers.get("location");
  }

  it("returns to My groups when asked to", async () => {
    expect(await leave("mina-grupper")).toBe("/mina-grupper?lamnad=1");
  }, 15_000);

  it("falls back to the landing page otherwise, and never follows a URL from the form", async () => {
    expect(await leave(null)).toBe("/?lamnad=1");
    expect(await leave("https://evil.example/")).toBe("/?lamnad=1");
    expect(await leave("//evil.example")).toBe("/?lamnad=1");
  }, 30_000);
});

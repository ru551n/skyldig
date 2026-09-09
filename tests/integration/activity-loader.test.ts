import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createBrowserSession, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { getCookieName } from "../../server/modules/auth/cookie.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { loader } from "../../app/routes/session/activity.tsx";
import type { Route } from "../../app/routes/session/+types/activity.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

function cookieHeaderFor(token: string) {
  return `${getCookieName(config)}=${token}`;
}

function requestFor(token: string, path: string) {
  const headers = new Headers({ cookie: cookieHeaderFor(token) });
  return new Request(`https://skyldig.example${path}`, { headers });
}

/** Builds the (loosely typed) LoaderArgs this loader actually reads: `request` and `params`. */
function loaderArgsFor(request: Request, sid: string): Route.LoaderArgs {
  return { request, params: { sid } } as unknown as Route.LoaderArgs;
}

async function makeAccessibleSession() {
  const { session } = await createSession(db, config, {
    name: "Cabin trip",
    baseCurrency: "SEK",
    participantNames: ["Alice", "Bob"],
  });
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.publicId, session.publicId))
    .limit(1);
  const browserSession = await db.transaction((tx) => createBrowserSession(tx));
  await db.transaction((tx) => grantAccess(tx, browserSession.id, row!.id, "member"));
  return { session, token: browserSession.token };
}

describe("session activity loader — ?before validation", () => {
  it(
    "ignores an unparseable ?before instead of throwing",
    async () => {
      const { session, token } = await makeAccessibleSession();
      const request = requestFor(token, `/s/${session.publicId}/aktivitet?before=abc`);

      const result = await loader(loaderArgsFor(request, session.publicId));

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    },
    15_000,
  );

  it(
    "ignores an empty ?before",
    async () => {
      const { session, token } = await makeAccessibleSession();
      const request = requestFor(token, `/s/${session.publicId}/aktivitet?before=`);

      const result = await loader(loaderArgsFor(request, session.publicId));

      expect(result.items).toEqual([]);
    },
    15_000,
  );

  it(
    "still honours a valid ?before ISO timestamp",
    async () => {
      const { session, token } = await makeAccessibleSession();
      const request = requestFor(
        token,
        `/s/${session.publicId}/aktivitet?before=${new Date().toISOString()}`,
      );

      const result = await loader(loaderArgsFor(request, session.publicId));

      expect(result.items).toEqual([]);
    },
    15_000,
  );
});

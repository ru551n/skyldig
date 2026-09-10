/**
 * The Admin page is the only place to re-enter the admin key and the only place to delete a
 * group. Admin elevation is time-boxed, and the layout originally gated the Admin nav link on
 * the *effective* role — so 30 minutes after elevating, the link vanished and an admin had no
 * visible path to re-elevate or delete their own group. The link must follow the *stored*
 * grant, while authorization elsewhere keeps using the effective role.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import {
  adminElevationExpiry,
  createBrowserSession,
  grantAccess,
} from "../../server/modules/auth/browser-session.ts";
import { getCookieName } from "../../server/modules/auth/cookie.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { loader } from "../../app/routes/session/layout.tsx";
import type { Route } from "../../app/routes/session/+types/layout.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function makeSessionWithGrant(role: "member" | "admin", adminUntil: Date | null) {
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
  await db.transaction((tx) => grantAccess(tx, browserSession.id, row!.id, role, adminUntil));
  return { session, token: browserSession.token };
}

async function loadFor(token: string, publicId: string) {
  const headers = new Headers({ cookie: `${getCookieName(config)}=${token}` });
  const request = new Request(`https://skyldig.example/s/${publicId}`, { headers });
  return loader({ request, params: { sid: publicId } } as unknown as Route.LoaderArgs);
}

describe("session layout loader — Admin nav visibility", () => {
  it(
    "shows the Admin link during an active elevation",
    async () => {
      const { session, token } = await makeSessionWithGrant("admin", adminElevationExpiry(config));
      const loaded = await loadFor(token, session.publicId);
      expect(loaded.role).toBe("admin");
      expect(loaded.showAdminNav).toBe(true);
    },
    15_000,
  );

  it(
    "keeps the Admin link after the elevation lapses, while the effective role drops to member",
    async () => {
      const { session, token } = await makeSessionWithGrant("admin", new Date(Date.now() - 60_000));
      const loaded = await loadFor(token, session.publicId);
      expect(loaded.role).toBe("member");
      expect(loaded.showAdminNav).toBe(true);
    },
    15_000,
  );

  it(
    "never shows the Admin link to a plain member",
    async () => {
      const { session, token } = await makeSessionWithGrant("member", null);
      const loaded = await loadFor(token, session.publicId);
      expect(loaded.role).toBe("member");
      expect(loaded.showAdminNav).toBe(false);
    },
    15_000,
  );
});

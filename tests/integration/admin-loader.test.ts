/**
 * The admin route's loader is what makes admin-elevation expiry *visible* (v0.1.1 made
 * elevation time-boxed, which locked people out with no on-screen explanation). These tests
 * pin the two fields the UI renders from: `adminUntil` (when the current elevation lapses) and
 * `elevationLapsed` (the grant is stored as 'admin' but the window has passed, so the screen
 * can say "re-enter the key" rather than "you are not an admin").
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
import { loader } from "../../app/routes/session/admin.tsx";
import type { Route } from "../../app/routes/session/+types/admin.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

function requestFor(token: string, path: string) {
  const headers = new Headers({ cookie: `${getCookieName(config)}=${token}` });
  return new Request(`https://skyldig.example${path}`, { headers });
}

function loaderArgsFor(request: Request, sid: string): Route.LoaderArgs {
  return { request, params: { sid } } as unknown as Route.LoaderArgs;
}

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

interface AdminLoaderData {
  isAdmin: boolean;
  adminTtlMinutes: number;
  adminUntil: string | null;
  elevationLapsed: boolean;
}

async function loadFor(token: string, publicId: string): Promise<AdminLoaderData> {
  const result = await loader(loaderArgsFor(requestFor(token, `/s/${publicId}/admin`), publicId));
  // The loader wraps its payload in `data(...)` to attach `Cache-Control: no-store`.
  return (result as unknown as { data: AdminLoaderData }).data;
}

describe("admin loader — elevation visibility", () => {
  it(
    "exposes when an active elevation expires",
    async () => {
      const until = adminElevationExpiry(config);
      const { session, token } = await makeSessionWithGrant("admin", until);

      const loaded = await loadFor(token, session.publicId);

      expect(loaded.isAdmin).toBe(true);
      expect(loaded.elevationLapsed).toBe(false);
      expect(loaded.adminUntil).toBe(until.toISOString());
      expect(loaded.adminTtlMinutes).toBe(Math.round(config.adminElevationTtlMs / 60_000));
    },
    15_000,
  );

  it(
    "reports a lapsed elevation so the elevate screen can say so",
    async () => {
      const { session, token } = await makeSessionWithGrant("admin", new Date(Date.now() - 1_000));

      const loaded = await loadFor(token, session.publicId);

      expect(loaded.isAdmin).toBe(false);
      expect(loaded.adminUntil).toBeNull();
      expect(loaded.elevationLapsed).toBe(true);
    },
    15_000,
  );

  it(
    "does not report a lapsed elevation for a plain member",
    async () => {
      const { session, token } = await makeSessionWithGrant("member", null);

      const loaded = await loadFor(token, session.publicId);

      expect(loaded.isAdmin).toBe(false);
      expect(loaded.adminUntil).toBeNull();
      expect(loaded.elevationLapsed).toBe(false);
    },
    15_000,
  );
});

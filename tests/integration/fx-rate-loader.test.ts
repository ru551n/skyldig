import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "../../server/config.ts";
import { sessions } from "../../server/db/schema.ts";
import { createBrowserSession, grantAccess } from "../../server/modules/auth/browser-session.ts";
import { getCookieName } from "../../server/modules/auth/cookie.ts";
import { createSession } from "../../server/modules/session/session.ts";
import { __clearFxRateCacheForTests } from "../../server/modules/fx/rate-provider.ts";
import { loader } from "../../app/routes/session/fx-rate.tsx";
import type { Route } from "../../app/routes/session/+types/fx-rate.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
  __clearFxRateCacheForTests();
});

function cookieHeaderFor(token: string) {
  return `${getCookieName(config)}=${token}`;
}

function requestFor(token: string | null, path: string) {
  const headers = token ? new Headers({ cookie: cookieHeaderFor(token) }) : new Headers();
  return new Request(`https://skyldig.example${path}`, { headers });
}

/** Builds the (loosely typed) LoaderArgs this loader actually reads: `request`, `params`, `context`. */
function loaderArgsFor(request: Request, sid: string): Route.LoaderArgs {
  return {
    request,
    params: { sid },
    context: { get: () => undefined },
  } as unknown as Route.LoaderArgs;
}

async function makeAccessibleSession(baseCurrency = "SEK") {
  const { session } = await createSession(db, config, {
    name: "Cabin trip",
    baseCurrency,
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("fx-rate resource route loader", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalEnabled: boolean;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rates: { SEK: 11.15 } }));
    vi.stubGlobal("fetch", fetchMock);
    // This suite exercises the route's own auth/rate-limit behavior, independent of whether
    // the process as a whole was started with `FX_RATE_LOOKUP_ENABLED=false` — force lookups
    // on so the mocked `fetch` above is actually exercised.
    originalEnabled = config.fxRateLookupEnabled;
    // @ts-expect-error -- test-only mutation of a readonly config field
    config.fxRateLookupEnabled = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- restore
    config.fxRateLookupEnabled = originalEnabled;
  });

  it("returns 404 for an unauthenticated request, same as every other session route", async () => {
    const { session } = await makeAccessibleSession();
    const request = requestFor(null, `/s/${session.publicId}/fx-rate?currency=EUR&date=2026-09-09`);

    await expect(loader(loaderArgsFor(request, session.publicId))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns 200 with a rate shape for an authenticated request on a supported pair", async () => {
    const { session, token } = await makeAccessibleSession("SEK");
    const request = requestFor(token, `/s/${session.publicId}/fx-rate?currency=EUR&date=2026-09-09`);

    const result = await loader(loaderArgsFor(request, session.publicId));

    expect(result.data).toEqual({ rate: { rateText: "11.15", rateDirection: "base_per_unit" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves to a null rate (never an error) once the client's rate limit is exceeded", async () => {
    const { session, token } = await makeAccessibleSession("SEK");

    // The rate limiter's per-client key falls back to "unknown" here (no client IP is wired
    // into the fake test context), so every call in this test shares one bucket — exhaust the
    // configured 30/minute budget, then confirm the 31st still comes back as an ordinary
    // `{ rate: null }`, not a thrown error.
    for (let i = 0; i < 30; i++) {
      const request = requestFor(token, `/s/${session.publicId}/fx-rate?currency=EUR&date=2026-09-09`);
      await loader(loaderArgsFor(request, session.publicId));
    }

    const request = requestFor(token, `/s/${session.publicId}/fx-rate?currency=EUR&date=2026-09-09`);
    const result = await loader(loaderArgsFor(request, session.publicId));

    expect(result.data).toEqual({ rate: null });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "../../config.ts";
import { __clearFxRateCacheForTests, fetchDailyRate } from "./rate-provider.ts";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("fetchDailyRate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalEnabled: boolean;

  beforeEach(() => {
    __clearFxRateCacheForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // These tests exercise fetchDailyRate's own logic and must behave the same regardless of
    // how the test suite as a whole is invoked (e.g. a `FX_RATE_LOOKUP_ENABLED=false` run) —
    // force lookups on here; the dedicated "disabled" test below flips it off deliberately.
    originalEnabled = config.fxRateLookupEnabled;
    // @ts-expect-error -- test-only mutation of a readonly config field
    config.fxRateLookupEnabled = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // @ts-expect-error -- restore
    config.fxRateLookupEnabled = originalEnabled;
  });

  it("returns a rateText/rateDirection shape on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ amount: 1, base: "EUR", date: "2026-09-09", rates: { SEK: 11.1495 } }),
    );

    const result = await fetchDailyRate("EUR", "SEK", "2026-09-09");

    expect(result).toEqual({ rateText: "11.1495", rateDirection: "base_per_unit" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("from=EUR");
    expect(calledUrl).toContain("to=SEK");
  });

  it("uses /latest for today's date and the historical endpoint for a past date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    fetchMock.mockResolvedValueOnce(jsonResponse({ rates: { SEK: 11.1 } }));
    await fetchDailyRate("EUR", "SEK", today);
    expect(fetchMock.mock.calls[0][0] as string).toContain("/latest?");

    fetchMock.mockResolvedValueOnce(jsonResponse({ rates: { SEK: 10.9 } }));
    await fetchDailyRate("EUR", "SEK", "2020-01-01");
    expect(fetchMock.mock.calls[1][0] as string).toContain("/2020-01-01?");
  });

  it("returns null and does not call fetch when from === to", async () => {
    const result = await fetchDailyRate("SEK", "SEK", "2026-09-09");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const result = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    expect(result).toBeNull();
  });

  it("returns null on a malformed JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    } as unknown as Response);
    const result = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    expect(result).toBeNull();
  });

  it("returns null when the requested pair is missing from the response (unsupported currency)", async () => {
    // Frankfurter has no VND rate: `rates` comes back without it.
    fetchMock.mockResolvedValueOnce(jsonResponse({ rates: {} }));
    const result = await fetchDailyRate("EUR", "VND", "2026-09-09");
    expect(result).toBeNull();
  });

  it("returns null on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network error"));
    const result = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    expect(result).toBeNull();
  });

  it("returns null on a timeout (abort)", async () => {
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const promise = fetchDailyRate("EUR", "SEK", "2026-09-09");
    // Fire the abort synchronously via the mock instead of waiting out the real 5s timer.
    const signal = fetchMock.mock.calls[0][1].signal as AbortController["signal"];
    (signal as unknown as { dispatchEvent: (e: Event) => void }).dispatchEvent(new Event("abort"));

    const result = await promise;
    expect(result).toBeNull();
  });

  it("caches a successful result: a second call for the same (date, from, to) does not call fetch again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rates: { SEK: 11.1495 } }));

    const first = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    const second = await fetchDailyRate("EUR", "SEK", "2026-09-09");

    expect(first).toEqual({ rateText: "11.1495", rateDirection: "base_per_unit" });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed call: the next request for the same key retries fetch", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const first = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    expect(first).toBeNull();

    fetchMock.mockResolvedValueOnce(jsonResponse({ rates: { SEK: 11.1495 } }));
    const second = await fetchDailyRate("EUR", "SEK", "2026-09-09");
    expect(second).toEqual({ rateText: "11.1495", rateDirection: "base_per_unit" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null immediately, without calling fetch, when lookups are disabled", async () => {
    const original = config.fxRateLookupEnabled;
    // @ts-expect-error -- test-only mutation of a readonly config field
    config.fxRateLookupEnabled = false;
    try {
      const result = await fetchDailyRate("EUR", "SEK", "2026-09-09");
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      // @ts-expect-error -- restore
      config.fxRateLookupEnabled = original;
    }
  });
});

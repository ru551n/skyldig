import { config } from "../../config.ts";

/**
 * A live daily rate suggestion, in the same shape `parseRate`/the rate form field accept.
 * Frankfurter always reports "1 <from> = <value> <to>", which is exactly what
 * `base_per_unit` means (see `domain/currency/rate.ts`) — no inversion needed.
 */
export interface DailyRateSuggestion {
  rateText: string;
  rateDirection: "base_per_unit";
}

const FRANKFURTER_BASE_URL = "https://api.frankfurter.app";
const FETCH_TIMEOUT_MS = 5000;

/**
 * In-memory cache of successful lookups, keyed by `date|from|to`, for the remainder of the
 * process lifetime. Frankfurter's daily rate does not change intraday, so this is exact, not
 * approximate. Failed lookups are never cached (see `fetchDailyRate`), so a transient outage
 * is retried on the very next request rather than sticking for the rest of the process.
 */
const cache = new Map<string, DailyRateSuggestion>();

function cacheKey(date: string, from: string, to: string): string {
  return `${date}|${from}|${to}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FrankfurterBody {
  rates?: unknown;
}

function extractRateText(body: unknown, to: string): string | null {
  if (!body || typeof body !== "object") return null;
  const rates = (body as FrankfurterBody).rates;
  if (!rates || typeof rates !== "object") return null;
  const value = (rates as Record<string, unknown>)[to];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return String(value);
}

/**
 * Fetches the live market rate for "1 unit of `from` = ? units of `to`" on `date`
 * (`YYYY-MM-DD`) from Frankfurter (api.frankfurter.app), for use ONLY as a prefill suggestion
 * for the rate form field — see docs/architecture.md §5.1. It never feeds a stored conversion
 * directly; whatever ends up in the field (prefilled, edited, or manually typed) goes through
 * the same `parseRate`/`convertToBase` locked-conversion path as always.
 *
 * Uses `/latest` when `date` is today (cheaper, matches the common case) and the historical
 * `/{date}` endpoint otherwise.
 *
 * Returns `null` — never throws — on every failure mode: lookups disabled via
 * `FX_RATE_LOOKUP_ENABLED`, `from === to`, an unsupported currency (Frankfurter is missing
 * VND/KWD/BHD/TND, four of the currencies Skyldig itself supports), a network error, a
 * 5-second timeout, a non-200 response, or a malformed/missing response body. Successful
 * results are cached in-memory for the process lifetime keyed by `(date, from, to)`; failures
 * are not cached.
 */
export async function fetchDailyRate(
  from: string,
  to: string,
  date: string,
): Promise<DailyRateSuggestion | null> {
  if (!config.fxRateLookupEnabled) return null;
  if (from === to) return null;

  const key = cacheKey(date, from, to);
  const cached = cache.get(key);
  if (cached) return cached;

  const path = date === todayIso() ? "/latest" : `/${encodeURIComponent(date)}`;
  const url = `${FRANKFURTER_BASE_URL}${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    const rateText = extractRateText(body, to);
    if (!rateText) return null;

    const result: DailyRateSuggestion = { rateText, rateDirection: "base_per_unit" };
    cache.set(key, result);
    return result;
  } catch {
    // Network error, abort/timeout, or anything else unexpected — fail silently.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Test-only: clears the in-memory cache between test cases. */
export function __clearFxRateCacheForTests(): void {
  cache.clear();
}

import { data } from "react-router";

import { isKnownCurrency } from "@domain/currency/registry.ts";
import { clientKey, limiters } from "@server/modules/auth/rate-limit.ts";
import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { fetchDailyRate } from "@server/modules/fx/rate-provider.ts";

import { requestContext } from "~/context.ts";
import { getConfig, getDb } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/fx-rate";

export interface FxRateLoaderData {
  rate: { rateText: string; rateDirection: "base_per_unit" } | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function headersOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/**
 * Resource route (no UI, GET only): live daily exchange-rate lookup used to PREFILL the
 * expense/payment rate field, alongside (never instead of) the "last used in this session"
 * suggestion — see docs/architecture.md §5.1 and `server/modules/fx/rate-provider.ts`. The
 * field stays fully editable either way, and whatever ends up in it goes through the same
 * `parseRate`/`convertToBase` locked-conversion path manual entry always used.
 *
 * Requires `requireSessionAccess` (404 for anyone without a grant on this session, same as
 * every other session route) so an unauthenticated visitor can't relay free calls to
 * Frankfurter through this app. Rate-limited separately from `limiters.join`/`limiters.invite`
 * (see rate-limit.ts `limiters.fx`); every failure mode here — unknown/base currency, rate
 * limit exceeded, or the provider itself failing — resolves to `{ rate: null }` with a 200,
 * never a thrown error, so the client can treat "no live rate" as an ordinary, silent outcome.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);

  const url = new URL(request.url);
  const currency = url.searchParams.get("currency");
  const dateParam = url.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : todayIso();

  if (!currency || currency === access.session.baseCurrency || !isKnownCurrency(currency)) {
    return data<FxRateLoaderData>({ rate: null });
  }

  const clientIp = context.get(requestContext)?.clientIp;
  const key = clientKey({ ip: clientIp, headers: headersOf(request) }, config);
  const check = limiters.fx.check(key);
  if (!check.allowed) {
    return data<FxRateLoaderData>({ rate: null });
  }

  const rate = await fetchDailyRate(currency, access.session.baseCurrency, date);
  return data<FxRateLoaderData>({ rate });
}


/** No default export and no action — this route is GET/loader-only (no UI). */

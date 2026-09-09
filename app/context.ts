import { createContext } from "react-router";

import type { logger as appLogger } from "@server/logger.ts";

import type { Locale } from "~/i18n/index.ts";

export interface RequestContext {
  requestId: string;
  logger: typeof appLogger;
  /** The client IP as seen by Express (`req.ip`), used for rate-limit keys. */
  clientIp?: string;
  /** Per-request CSP nonce (see docs/architecture.md §4.4), applied to inline/hydration scripts. */
  cspNonce: string;
  /** The active interface locale, resolved from the `skyldig_lang` cookie or `Accept-Language`. */
  locale: Locale;
}

export const requestContext = createContext<RequestContext>();

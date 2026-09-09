import { createContext } from "react-router";

import type { logger as appLogger } from "@server/logger.ts";

export interface RequestContext {
  requestId: string;
  logger: typeof appLogger;
  /** The client IP as seen by Express (`req.ip`), used for rate-limit keys. */
  clientIp?: string;
}

export const requestContext = createContext<RequestContext>();

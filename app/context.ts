import { createContext } from "react-router";

import type { logger as appLogger } from "@server/logger.ts";

export interface RequestContext {
  requestId: string;
  logger: typeof appLogger;
}

export const requestContext = createContext<RequestContext>();

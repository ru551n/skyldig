import { createContext } from "react";

import type { Locale } from "./index.ts";

/**
 * The active interface locale, provided once in `app/root.tsx`'s `Layout` from the root
 * loader's `locale` (itself resolved server-side from the `skyldig_lang` cookie or
 * `Accept-Language`). Defaults to Swedish so any component rendered outside the provider
 * (there shouldn't be any) still gets sane output rather than throwing.
 */
export const LocaleContext = createContext<Locale>("sv");

import { describe, expect, it } from "vitest";

import { resolveLocale } from "./locale-cookie.ts";

describe("resolveLocale", () => {
  it("lets ?lang= win over the cookie and Accept-Language, so each language has its own URL", () => {
    expect(resolveLocale("skyldig_lang=sv", "sv-SE", "en")).toBe("en");
    expect(resolveLocale("skyldig_lang=en", "en-GB", "sv")).toBe("sv");
  });

  it("ignores an unknown ?lang= value and falls back to the cookie, then Accept-Language", () => {
    expect(resolveLocale("skyldig_lang=en", "sv-SE", "de")).toBe("en");
    expect(resolveLocale(null, "en-US,en;q=0.9", "xx")).toBe("en");
    expect(resolveLocale(null, null, null)).toBe("sv");
  });
});

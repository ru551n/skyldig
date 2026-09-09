import { describe, expect, it } from "vitest";

import { PHRASE_WORDS, generatePhrase, phraseEntropyBits } from "./phrase.ts";
import { WORDLIST } from "./wordlist.generated.ts";

const WORD_SET = new Set(WORDLIST);

describe("generatePhrase", () => {
  it("produces PHRASE_WORDS hyphen-separated lowercase words", () => {
    const phrase = generatePhrase();
    const words = phrase.split("-");
    expect(words).toHaveLength(PHRASE_WORDS);
    for (const word of words) {
      expect(word).toMatch(/^[a-z]{3,8}$/);
      expect(WORD_SET.has(word)).toBe(true);
    }
  });

  it("generates 10000 phrases with no exact duplicate", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const phrase = generatePhrase();
      expect(seen.has(phrase)).toBe(false);
      seen.add(phrase);
    }
  });
});

describe("phraseEntropyBits", () => {
  it("is at least 44 bits", () => {
    expect(phraseEntropyBits()).toBeGreaterThanOrEqual(44);
  });
});

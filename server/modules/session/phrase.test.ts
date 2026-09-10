import { describe, expect, it } from "vitest";

import { normalizePhrase } from "../auth/crypto.ts";
import { PHRASE_WORDS, generatePhrase, phraseEntropyBits } from "./phrase.ts";
import { WORDLIST } from "./wordlist.generated.ts";

const WORD_SET = new Set(WORDLIST);

describe("generatePhrase", () => {
  it("draws five words per phrase", () => {
    // Pinned on purpose: lowering this silently weakens every new group's only credential.
    expect(PHRASE_WORDS).toBe(5);
  });

  it("draws from the vendored 2048-word BIP-39 English list", () => {
    // Generation is English regardless of the interface language (see phrase.ts). Pinned on
    // purpose: the count is what makes each word exactly 11 bits, and the anchors catch a
    // wordlist that was swapped or regenerated from the wrong source.
    expect(WORDLIST).toHaveLength(2048);
    expect(WORDLIST[0]).toBe("abandon");
    expect(WORDLIST[WORDLIST.length - 1]).toBe("zoo");
    // The old Swedish list is gone from generation; nothing on the verification path cares.
    expect(WORDLIST).not.toContain("abborre");
  });

  it("produces PHRASE_WORDS hyphen-separated lowercase words, all from the wordlist", () => {
    const phrase = generatePhrase();
    const words = phrase.split("-");
    expect(words).toHaveLength(PHRASE_WORDS);
    for (const word of words) {
      expect(word).toMatch(/^[a-z]{3,8}$/);
      expect(WORD_SET.has(word)).toBe(true);
    }
  });

  it("is already normalized (normalizePhrase is the identity on generated output)", () => {
    for (let i = 0; i < 100; i += 1) {
      const phrase = generatePhrase();
      expect(normalizePhrase(phrase)).toBe(phrase);
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
  it("is PHRASE_WORDS * log2(wordlist size), assuming a with-replacement draw", () => {
    expect(phraseEntropyBits()).toBeCloseTo(PHRASE_WORDS * Math.log2(WORDLIST.length), 10);
  });

  it("is exactly 55 bits (5 words from the 2048-word BIP-39 English list)", () => {
    expect(phraseEntropyBits()).toBe(55);
  });
});

describe("normalizePhrase does not depend on the word count", () => {
  const legacyFour = WORDLIST.slice(0, 4);
  const five = WORDLIST.slice(4, 9);

  it.each([
    ["legacy 4-word", legacyFour],
    ["5-word", five],
  ])("accepts case, whitespace, and separator variants of a %s phrase", (_label, words) => {
    const canonical = words.join("-");
    const messy = `  ${words.map((w, i) => (i % 2 === 0 ? w.toUpperCase() : w)).join("  ,  ")} . `;
    expect(normalizePhrase(messy)).toBe(canonical);
    expect(normalizePhrase(words.join(" "))).toBe(canonical);
    expect(normalizePhrase(words.join("."))).toBe(canonical);
    expect(normalizePhrase(canonical).split("-")).toHaveLength(words.length);
  });

  it("folds compatibility characters via NFKC without changing the word count", () => {
    // U+FB01 (ﬁ ligature) → "fi"; a fullwidth hyphen U+FF0D is folded to "-" by NFKC.
    expect(normalizePhrase("ﬁsk－bil－ko－hus－sol")).toBe("fisk-bil-ko-hus-sol");
  });
});

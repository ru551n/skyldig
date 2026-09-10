/**
 * Access phrase generation, per docs/architecture.md §4.1.
 *
 * The word list is imported from `wordlist.generated.ts` (built by `pnpm build:wordlist` from
 * the vendored BIP-39 English `wordlist.en.txt`) rather than read from disk at runtime. See scripts/build-wordlist.ts for
 * why: reading a plain-text asset via `node:fs` relative to `import.meta.url` is not reliable
 * once the server is bundled for SSR, while a generated `.ts` module bundles like any other
 * source file.
 *
 * Even though `wordlist.generated.ts` is produced by a validating build step, we re-validate
 * the invariants here at module load time and throw if they don't hold — a stale/hand-edited
 * generated file, or a build step that silently regressed, must never result in a weak or
 * broken phrase generator being loaded into a running server.
 */
import { randomInt } from "node:crypto";

import { WORDLIST } from "./wordlist.generated.ts";

/**
 * The list is **English regardless of the interface language** — a Swedish UI still issues an
 * English phrase. Typing five Swedish words on a mobile keyboard was a real burden, and BIP-39
 * English is built for exactly this: short, unambiguous, ASCII-only words, no two of which
 * share their first four letters.
 *
 * This is a *generation-only* switch. `normalizePhrase` performs no wordlist-membership and no
 * word-count check, so every phrase issued from the previous Swedish list keeps verifying and
 * joining unchanged; see the legacy-phrase regression tests in tests/integration/session.test.ts.
 */

const WORD_RE = /^[a-z]{3,8}$/;

function validateWordlist(words: readonly string[]): void {
  if (words.length < 2048) {
    throw new Error(`session/phrase: wordlist has only ${words.length} words, need >= 2048`);
  }
  const seen = new Set<string>();
  for (const word of words) {
    if (!WORD_RE.test(word)) {
      throw new Error(`session/phrase: invalid word in wordlist: ${JSON.stringify(word)}`);
    }
    if (seen.has(word)) {
      throw new Error(`session/phrase: duplicate word in wordlist: ${JSON.stringify(word)}`);
    }
    seen.add(word);
  }
}

validateWordlist(WORDLIST);

/**
 * Number of words drawn per *newly generated* access phrase. Raised from 4 to 5 in the
 * security-hardening pass; with the 2048-word BIP-39 list that is exactly 5 × 11 = 55 bits
 * (it was ~55.7 with the previous ~2250-word Swedish list). Nothing on the verification path
 * (`normalizePhrase` → HMAC blind index → scrypt verifier) depends on this number, so phrases
 * issued while it was 4 keep joining until their session expires or the phrase is rotated. Do
 * not add a word-count check to `joinSession`/`normalizePhrase` without an explicit migration.
 */
export const PHRASE_WORDS = 5;

/**
 * Draws `PHRASE_WORDS` words uniformly at random *with replacement* from the wordlist, using
 * `crypto.randomInt` (rejection-free, no modulo bias), joined with `-`. Words may repeat: the
 * entropy accounting (`phraseEntropyBits`) assumes a with-replacement draw, i.e.
 * log2(wordlist.length ^ PHRASE_WORDS), which for 2048 words and 5 draws is exactly 55 bits.
 */
export function generatePhrase(): string {
  const words: string[] = [];
  for (let i = 0; i < PHRASE_WORDS; i += 1) {
    words.push(WORDLIST[randomInt(0, WORDLIST.length)]);
  }
  return words.join("-");
}

/** Bits of entropy of `generatePhrase()`'s output, assuming a with-replacement draw. */
export function phraseEntropyBits(): number {
  return PHRASE_WORDS * Math.log2(WORDLIST.length);
}

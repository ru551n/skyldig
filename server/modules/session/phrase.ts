/**
 * Access phrase generation, per docs/architecture.md §4.1.
 *
 * The word list is imported from `wordlist.generated.ts` (built by `pnpm build:wordlist` from
 * `wordlist.sv.txt`) rather than read from disk at runtime. See scripts/build-wordlist.ts for
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

/** Number of words drawn per access phrase. */
export const PHRASE_WORDS = 6;

/**
 * Draws `PHRASE_WORDS` words uniformly at random *with replacement* from the wordlist, using
 * `crypto.randomInt` (rejection-free, no modulo bias), joined with `-`. Words may repeat: the
 * entropy accounting (`phraseEntropyBits`) assumes a with-replacement draw, i.e.
 * log2(wordlist.length ^ PHRASE_WORDS), which for ~2250 words and 6 draws is ~67 bits.
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

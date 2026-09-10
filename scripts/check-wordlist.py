#!/usr/bin/env python3
"""Validate the Skyldig access-phrase wordlist.

The list is `server/modules/session/wordlist.en.txt`: the BIP-39 English
wordlist, vendored verbatim from
https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt
(sha256 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda).

Phrases are generated in English regardless of the interface language;
see server/modules/session/phrase.ts. This script exists so a hand-edited
or accidentally-truncated list is caught in CI rather than at runtime,
and so the properties the phrase design leans on are stated somewhere
executable.

Checks (all must pass):
  - lowercase ASCII a-z only per line, no blank lines, no stray whitespace
  - length 3-8 letters inclusive
  - no duplicate words
  - the first four letters identify a word uniquely (words shorter than
    four letters must be unique in full) -- BIP-39's own guarantee, and
    what makes a mistyped or truncated word recoverable rather than
    silently a different word
  - exactly 2048 words, so a phrase word is exactly 11 bits
  - sorted alphabetically

Usage:
    python3 scripts/check-wordlist.py

Exits 0 and prints a summary on success. Exits 1 and prints every
violation found on failure.
"""

import os
import string
import sys
from collections import defaultdict

WORDLIST_RELATIVE_PATH = os.path.join("server", "modules", "session", "wordlist.en.txt")

MIN_LEN = 3
MAX_LEN = 8
EXPECTED_COUNT = 2048
UNIQUE_PREFIX_LEN = 4

ALLOWED_CHARS = set(string.ascii_lowercase)


def wordlist_path():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    return os.path.join(repo_root, WORDLIST_RELATIVE_PATH)


def main():
    path = wordlist_path()

    if not os.path.isfile(path):
        print(f"ERROR: wordlist file not found at {path}")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        raw_lines = f.read().split("\n")

    # The file must end with a single trailing newline, so split() leaves a
    # trailing empty string as the last element.
    lines = raw_lines[:-1] if raw_lines and raw_lines[-1] == "" else raw_lines

    violations = []
    words = []

    for idx, line in enumerate(lines, start=1):
        if line == "":
            violations.append(f"LINE {idx}: blank line")
            continue
        if line != line.strip():
            violations.append(f"LINE {idx}: word {line!r} has leading/trailing whitespace")
        word = line.strip()
        if any(ch not in ALLOWED_CHARS for ch in word):
            violations.append(f"LINE {idx}: {word!r} is not lowercase a-z only")
            continue
        if not (MIN_LEN <= len(word) <= MAX_LEN):
            violations.append(
                f"LINE {idx}: {word!r} is {len(word)} letters, must be {MIN_LEN}-{MAX_LEN}"
            )
            continue
        words.append(word)

    seen = {}
    for idx, word in enumerate(words, start=1):
        if word in seen:
            violations.append(f"DUPLICATE: {word!r} at positions {seen[word]} and {idx}")
        else:
            seen[word] = idx

    by_prefix = defaultdict(list)
    for word in words:
        by_prefix[word[:UNIQUE_PREFIX_LEN]].append(word)
    for prefix, group in sorted(by_prefix.items()):
        if len(group) > 1:
            violations.append(
                f"PREFIX COLLISION: {sorted(group)} share the first {UNIQUE_PREFIX_LEN} letters ({prefix!r})"
            )

    if len(words) != EXPECTED_COUNT:
        violations.append(
            f"WORD COUNT: {len(words)}, expected exactly {EXPECTED_COUNT} "
            "(a phrase word must be exactly 11 bits)"
        )

    if words != sorted(words):
        violations.append("FILE IS NOT SORTED ALPHABETICALLY")

    if violations:
        print("WORDLIST VALIDATION FAILED")
        print("=" * 60)
        for v in violations:
            print(v)
        print("=" * 60)
        print(f"Total words read: {len(words)}")
        sys.exit(1)

    lengths = [len(w) for w in words]
    print("Wordlist validation summary")
    print(f"  File: {path}")
    print(f"  Total word count: {len(words)}")
    print(f"  Min length: {min(lengths)}")
    print(f"  Max length: {max(lengths)}")
    print("ALL CHECKS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()

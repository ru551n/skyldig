#!/usr/bin/env python3
"""Validate the Skyldig Swedish wordlist.

Checks (all must pass):
  - lowercase ASCII a-z only per line
  - length 3-8 letters inclusive
  - no duplicate words
  - no word is a strict prefix of another word
  - pairwise Damerau-Levenshtein distance >= 2 for all word pairs
  - no suffix-inflection collisions (W + one of a fixed set of suffixes
    must not also appear as a separate word)

Usage:
    python3 scripts/check-wordlist.py

Exits 0 and prints a summary on success. Exits 1 and prints every
violation found on failure.
"""

import os
import string
import sys
from collections import defaultdict

WORDLIST_RELATIVE_PATH = os.path.join(
    "server", "modules", "session", "wordlist.sv.txt"
)

MIN_LEN = 3
MAX_LEN = 8
MIN_DISTANCE = 2  # pairwise DL distance must be >= this

INFLECTION_SUFFIXES = ["s", "n", "t", "en", "et", "ar", "er", "or", "na", "de"]

ALLOWED_CHARS = set(string.ascii_lowercase)


def wordlist_path():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    return os.path.join(repo_root, WORDLIST_RELATIVE_PATH)


def damerau_levenshtein_leq(a, b, max_dist):
    """Return the Damerau-Levenshtein distance between a and b if it is
    <= max_dist, otherwise return max_dist + 1 (exact value not needed
    beyond the threshold). Uses the classic DP table restricted to a
    band, which is plenty fast for short words (<=8 chars) with a small
    max_dist.
    """
    la, lb = len(a), len(b)

    # Quick length-based short circuit.
    if abs(la - lb) > max_dist:
        return max_dist + 1

    # Standard full DP (words are short, so this is cheap) with
    # transposition support (Damerau-Levenshtein, restricted/OSA variant
    # is not sufficient for true DL, so we use the full DL recurrence).
    INF = float("inf")
    da = {}
    max_dist_local = max_dist  # not used for early abort inside DP itself

    d = [[0] * (lb + 2) for _ in range(la + 2)]
    max_edit = la + lb
    d[0][0] = max_edit
    for i in range(0, la + 1):
        d[i + 1][0] = max_edit
        d[i + 1][1] = i
    for j in range(0, lb + 1):
        d[0][j + 1] = max_edit
        d[1][j + 1] = j

    for i in range(1, la + 1):
        db = 0
        for j in range(1, lb + 1):
            i1 = da.get(b[j - 1], 0)
            j1 = db
            if a[i - 1] == b[j - 1]:
                cost = 0
                db = j
            else:
                cost = 1
            d[i + 1][j + 1] = min(
                d[i][j] + cost,
                d[i + 1][j] + 1,
                d[i][j + 1] + 1,
                d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1),
            )
        da[a[i - 1]] = i

    return d[la + 1][lb + 1]


def main():
    path = wordlist_path()

    if not os.path.isfile(path):
        print(f"ERROR: wordlist file not found at {path}")
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        raw_lines = f.read().split("\n")

    # File should end with a single trailing newline -> split produces a
    # trailing empty string as the last element.
    if raw_lines and raw_lines[-1] == "":
        lines = raw_lines[:-1]
    else:
        lines = raw_lines

    violations = []

    invalid_char_words = []
    wrong_length_words = []
    blank_lines = []

    for idx, line in enumerate(lines, start=1):
        if line == "":
            blank_lines.append(idx)
            continue
        if line != line.strip():
            violations.append(
                f"LINE {idx}: word {line!r} has leading/trailing whitespace"
            )
        word = line
        if not word or any(ch not in ALLOWED_CHARS for ch in word):
            invalid_char_words.append((idx, word))
            continue
        if not (MIN_LEN <= len(word) <= MAX_LEN):
            wrong_length_words.append((idx, word))

    if blank_lines:
        violations.append(f"BLANK LINES found at: {blank_lines}")

    if invalid_char_words:
        violations.append("INVALID CHARACTER WORDS (must be lowercase a-z only):")
        for idx, w in invalid_char_words:
            violations.append(f"  line {idx}: {w!r}")

    if wrong_length_words:
        violations.append(f"WRONG LENGTH WORDS (must be {MIN_LEN}-{MAX_LEN} letters):")
        for idx, w in wrong_length_words:
            violations.append(f"  line {idx}: {w!r} (length {len(w)})")

    # From here on, only consider well-formed words (valid chars, valid
    # length) to keep the remaining checks meaningful; but duplicates
    # should be checked across all non-blank lines regardless.
    all_words_in_order = [line for line in lines if line != ""]

    # Duplicates
    seen = {}
    duplicates = []
    for idx, w in enumerate(all_words_in_order, start=1):
        if w in seen:
            duplicates.append((seen[w], idx, w))
        else:
            seen[w] = idx

    if duplicates:
        violations.append("DUPLICATE WORDS:")
        for first_idx, dup_idx, w in duplicates:
            violations.append(
                f"  {w!r} first seen at line {first_idx}, duplicated at line {dup_idx}"
            )

    words = sorted(set(all_words_in_order))
    # Restrict further checks to well-formed words only.
    bad_words = {w for _, w in invalid_char_words} | {w for _, w in wrong_length_words}
    words = [w for w in words if w not in bad_words]

    word_set = set(words)

    # Prefix check
    prefix_violations = []
    # Group by first char for a bit of pruning, but N is small enough
    # that a direct approach is fine too. We do it properly: for each
    # word, check whether any proper prefix of it is also in the set.
    for w in words:
        for cut in range(MIN_LEN, len(w)):
            prefix = w[:cut]
            if prefix in word_set:
                prefix_violations.append((prefix, w))

    if prefix_violations:
        violations.append("PREFIX VIOLATIONS (one word is a strict prefix of another):")
        for a, b in prefix_violations:
            violations.append(f"  {a!r} is a prefix of {b!r}")

    # Suffix-inflection check
    suffix_violations = []
    for w in words:
        for suf in INFLECTION_SUFFIXES:
            candidate = w + suf
            if candidate in word_set:
                suffix_violations.append((w, candidate, suf))

    if suffix_violations:
        violations.append("SUFFIX-INFLECTION COLLISIONS:")
        for base, candidate, suf in suffix_violations:
            violations.append(
                f"  {base!r} + {suf!r} == {candidate!r}, both present"
            )

    # Pairwise Damerau-Levenshtein distance check, bucketed by length.
    by_length = defaultdict(list)
    for w in words:
        by_length[len(w)].append(w)

    distance_violations = []
    lengths = sorted(by_length.keys())
    for li in lengths:
        group_words = by_length[li]
        # same-length pairs
        n = len(group_words)
        for i in range(n):
            wi = group_words[i]
            for j in range(i + 1, n):
                wj = group_words[j]
                dist = damerau_levenshtein_leq(wi, wj, MIN_DISTANCE - 1)
                if dist < MIN_DISTANCE:
                    distance_violations.append((wi, wj, dist))
        # cross length li vs li+1
        if (li + 1) in by_length:
            for wi in group_words:
                for wj in by_length[li + 1]:
                    dist = damerau_levenshtein_leq(wi, wj, MIN_DISTANCE - 1)
                    if dist < MIN_DISTANCE:
                        distance_violations.append((wi, wj, dist))

    if distance_violations:
        violations.append(
            f"DISTANCE VIOLATIONS (Damerau-Levenshtein distance < {MIN_DISTANCE}):"
        )
        for a, b, dist in distance_violations:
            violations.append(f"  {a!r} <-> {b!r}: distance {dist}")

    # Sortedness check (informational but part of "clear report")
    if all_words_in_order != sorted(all_words_in_order):
        violations.append("FILE IS NOT SORTED ALPHABETICALLY")

    if violations:
        print("WORDLIST VALIDATION FAILED")
        print("=" * 60)
        for v in violations:
            print(v)
        print("=" * 60)
        print(f"Total violations sections above; total words read: {len(all_words_in_order)}")
        sys.exit(1)

    lengths_all = [len(w) for w in words]
    print("Wordlist validation summary")
    print(f"  File: {path}")
    print(f"  Total word count: {len(words)}")
    print(f"  Min length: {min(lengths_all)}")
    print(f"  Max length: {max(lengths_all)}")
    print("ALL CHECKS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()

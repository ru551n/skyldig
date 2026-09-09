# Open items

Planned work and known gaps. Each entry says what is wanted or wrong and what doing it
involves. Nothing here blocks the MVP, which is complete and verified (see the README status
table).

- [Planned changes](#planned-changes) — requested work not yet started.
- [Known gaps](#known-gaps) — verified shortcomings in what already ships.


# Planned changes

## Design a logo and show it on the landing page

The landing page currently opens with the word "Skyldig" set in Familjen Grotesk and a small
static settle-up row as the illustration. It needs a real mark.

The name means "owing" in Swedish, and the product's whole job is resolving a tangle of debts
into a few clean payments, so the arrow motif already used in the settle-up rows is the obvious
place to start. Whatever is drawn should work as a 20 px favicon, sit beside the wordmark in
the top bar of every session page, and hold up on the pine, frost and paper backgrounds defined
in `docs/design.md`.

Deliver it as inline SVG rather than a raster file, so it inherits `currentColor` and stays
crisp; add a favicon and an apple-touch icon; and give it a proper accessible name where it
stands alone as a link.

## Add English as a second language

The interface is Swedish only. The groundwork is already in place: every visible string goes
through the typed `t()` helper in `app/i18n/`, so no component holds hard-coded Swedish, and
adding a language means adding a catalogue with the same shape rather than touching components.

The work is: write `app/i18n/en.ts` against the type derived from `sv.ts` so a missing key is a
compile error; decide how the locale is chosen and remembered (the `Accept-Language` header for
a first visit, with an explicit switcher that persists the choice, most simply in the browser
session row so it survives across devices sharing a group); thread the active locale through
the root context, which already carries it, and into every `Intl` call for dates and currency;
and set `<html lang>` from it.

Two things need care. Currency formatting already uses `Intl` with the active locale, so
amounts will change shape between languages, which is correct but worth a screenshot check. And
the access phrase stays Swedish regardless of interface language, because the wordlist is what
the entropy calculation and the stored blind index depend on; the English catalogue should
explain the phrase rather than imply it will be in English.

## Shorten the access phrase to three words

Requested so the phrase is quicker to read out and type. It is a straight trade against
brute-force resistance, and the numbers matter, so they are recorded here.

The wordlist holds 2250 words. Phrase length gives:

| Words | Entropy | Combinations |
|---|---|---|
| 3 | 33.4 bits | 11 billion |
| 4 | 44.5 bits | 26 trillion |
| 5 | 55.7 bits | 58 quadrillion |
| 6 (today) | 66.8 bits | 130 quintillion |

Three words is a large reduction. The specific risk is not offline cracking, which the scrypt
verifier already makes expensive, but online guessing: because a guess is resolved through a
single blind-index lookup, one attempt is tested against every active group at once. With ten
thousand live groups, a random guess hits roughly once in a million, which a distributed
attacker can reach. At six words the same attack is hopeless.

If the phrase is shortened, it should not be shortened alone. Options, roughly in order of how
much they buy:

- **Use four words instead of three.** 44.5 bits, still short to dictate, and about two
  thousand times harder to guess than three.
- **Add a check character.** A short suffix derived from the words catches typos client-side
  before an attempt reaches the limiter, so the rate limit is spent on real attacks rather than
  mistakes.
- **Tighten the limits.** The current join limit is ten attempts per ten minutes per client,
  sixty per hour, three hundred globally. At three words the global cap is what stands between
  the app and a distributed sweep, and it should come down.
- **Grow the wordlist.** Doubling it to 4500 words adds one bit per word; that is far less than
  it sounds and does not substitute for the word count.

Whatever is chosen, the constant lives in `server/modules/session/phrase.ts` (`PHRASE_WORDS`),
`phraseEntropyBits()` is logged at startup, and the change must be reflected in
`docs/architecture.md` §4.1, the README security section, the `/guide` page and the tests that
assert a six-word shape. Existing groups keep working, since only the hash is stored.

# Known gaps

## Verify the Docker deployment

`docker build` and `docker compose up` have never been executed, because the machine the app
was built on has no Docker and no sudo. The Dockerfile and `compose.yaml` were reviewed line by
line, and the runtime file set was proven to boot by assembling it by hand (production
dependencies, `build/`, `drizzle/`, `server.js`) and starting it against a real database:
migrations ran and `/health`, `/ready` and the landing page all responded.

Unverified as a result: the multi-stage image actually building, the final image size, the
`wget` healthcheck inside Alpine, `pg_isready` against the real `postgres:17-alpine` image, and
the `depends_on: condition: service_healthy` timing between the two containers.

Do this first on any machine that has Docker. It is the only part of the definition of done
that rests on reading rather than running.

## Dialog exit animation never plays

`app/components/ui/Dialog.tsx` passes an `exit` transition to the motion element, but the
component is not wrapped in `AnimatePresence`, so React unmounts the content immediately and
the exit is dead code. Dialogs animate in over 160 ms and vanish instantly on close.

Cosmetic only. It does not affect the focus restoration on close, which is implemented
separately and covered by an end-to-end test.

Fix by either wrapping the portal content in `AnimatePresence` and driving it from the `open`
prop, or deleting the unused `exit` prop. Prefer whichever keeps the focus-restore behaviour
intact, and re-run `tests/e2e/a11y.spec.ts` afterwards, since `AnimatePresence` delays unmount
and could change when Radix restores focus.

## Expense edit form falls back to array index for split ordering

`app/components/expense/ExpenseForm.tsx` accepts an optional `position` per participant and
falls back to the array index when it is missing. The new-expense route supplies the real
position; `app/routes/session/expense-edit.tsx` does not, so the edit form's split preview
orders the rounding remainder by index.

Harmless today, because `listParticipants` returns rows in position order and the relabelling
is monotone, so the same participants receive the extra minor unit. It is a latent divergence
between the preview and what the server stores, and it would become a real mismatch if the
participant list ever arrived in another order.

Fix by threading `position` through the edit route's loader the way the new-expense route does,
then making `position` required on the component's participant type so the fallback can be
removed.

## Style sources still allow inline CSS

The Content Security Policy is nonce-based for scripts, but `style-src` includes
`'unsafe-inline'`. This is required because the animation library resets `style.cssText` when a
dialog closes, which counts as an inline style injection rather than a scripted property write.

Scripts, which are the dangerous case, are fully locked down. Removing the exception would mean
replacing the dialog's motion usage with CSS animations, or nonce-ing the styles the library
writes, which the library does not currently support.

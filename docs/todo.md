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

## Share a group by QR code or link

Asked for so people can join by pointing a phone at a screen instead of typing the phrase.
Worth doing, but the obvious version conflicts with the credential design, so the choice
matters.

The phrase is a bearer credential: anyone holding it can read and change everything in the
group. `docs/architecture.md` §4 deliberately keeps it out of URLs, because a URL leaks in ways
a typed phrase does not — browser history, the `Referer` header on any outbound link, server
and proxy access logs, chat previews that unfurl links, and screenshots.

Three options, weakest to strongest.

**A link with the phrase in the query string.** `/join?nyckel=skog-banan-fyrkant-mossa`. Easy,
and the worst of the three: the phrase lands in this app's own access logs, in any reverse
proxy in front of it, and in the history of every device that opens it. Rejected.

**A link with the phrase in the fragment.** `/join#skog-banan-fyrkant-mossa`. Fragments are
never sent to the server, so nothing is logged server-side; a small script reads it, fills the
field, and clears the fragment with `history.replaceState`. Cheap and a genuine improvement,
but the phrase is still in the URL the user pasted or scanned, so it survives in browser
history and in whatever chat app carried it. Acceptable for a QR code shown on a screen in
person, questionable for a link sent in a group chat.

**A separate single-use invite token.** Generate a short-lived, single-use, high-entropy token
stored alongside the group (hashed, like the phrase); the link carries the token, and
redeeming it grants a browser session and burns the token. The phrase never travels. This
also gives an invite a natural expiry and lets a creator revoke one that went to the wrong
place, neither of which a bare phrase link can do. It is the only option that is strictly
better than reading the phrase aloud.

Recommended: implement the invite token, and render it as a QR code on the group's own page
(and optionally on the creation screen) with a "show QR" action, plus the same short link to
copy. Encode the absolute URL built from `PUBLIC_ORIGIN`. Generate the QR in the browser rather
than pulling in an image service, since the Content Security Policy allows no third-party
origins and an external generator would see the invite.

Scope, if built: a `session_invites` table (token hash, group, created, expires, used); create
and redeem functions in `server/modules/session/`; a redeem route that rate limits like `/join`
does; a QR component using a small client-side library (check it is on the allowed dependency
set and has no runtime network access); the guide page updated; and tests covering redeem,
reuse of a burnt token, and an expired token.

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

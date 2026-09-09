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

## Style sources still allow inline CSS

The Content Security Policy is nonce-based for scripts, but `style-src` includes
`'unsafe-inline'`. This is required because the animation library resets `style.cssText` when a
dialog closes, which counts as an inline style injection rather than a scripted property write.

Scripts, which are the dangerous case, are fully locked down. Removing the exception would mean
replacing the dialog's motion usage with CSS animations, or nonce-ing the styles the library
writes, which the library does not currently support.

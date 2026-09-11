# Open items

Planned work and known gaps. Each entry says what is wanted or wrong and what doing it
involves. Nothing here blocks the MVP, which is complete and verified (see the README status
table).

- [Planned changes](#planned-changes) — requested work not yet started.
- [Known gaps](#known-gaps) — verified shortcomings in what already ships.


# Planned changes

The logo and English localisation both shipped. The QR/invite feature and the shorter access
phrase, requested earlier, also shipped and are described in the git history rather than kept
here. The screenshot sets were regenerated to match (BIP-39 phrases, the 24-hour invite copy,
the admin-key acknowledgement gate) and are also described in the git history rather than kept
here.

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

There is now also `.github/workflows/docker-release.yml`, which builds and pushes the image
to Docker Hub as `ru551n/skyldig` on every published GitHub Release. It has never run either
— it needs the `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` repository secrets set (see the README
"Publishing a release image" section) and a real release to trigger it. Cutting a real
release, even a `v0.0.1` pre-release, is the fastest way to verify both this workflow and the
image build together.

## Style sources still allow inline CSS

The Content Security Policy is nonce-based for scripts, but `style-src` includes
`'unsafe-inline'`. This is required because the animation library resets `style.cssText` when a
dialog closes, which counts as an inline style injection rather than a scripted property write.

Scripts, which are the dangerous case, are fully locked down. Removing the exception would mean
replacing the dialog's motion usage with CSS animations, or nonce-ing the styles the library
writes, which the library does not currently support.

## Group creation only has rate limiting, no CAPTCHA

`POST /new` is rate limited (`server/modules/auth/rate-limit.ts`'s `createSession` /
`createSessionGlobal`, docs/architecture.md §4.4) — 15/10 min and 40/h per client key, 60/h
across all clients — so a scripted flood of group creation is bounded rather than unlimited.
It is not backed by a CAPTCHA. That was a deliberate choice, not an oversight: every CAPTCHA
worth using is a third-party script pulled from someone else's server, which would need a site
key most self-hosters would have to sign up for and configure, contradicting the zero-external-
dependency self-hosting principle described elsewhere in docs/architecture.md. Rate limiting
alone is a reasonable default because the actual harm of a flood — junk groups occupying
storage for their 90-day lifetime and slowing admin/backup operations on `sessions` — is
already meaningfully blunted without it. A self-hoster who wants stronger bot resistance than a
rate limiter provides can front the app with something like Cloudflare Turnstile at the reverse
proxy layer, gating `/new` before it ever reaches the app; that requires no application change.

## Smoke-test the production image in CI

*Partly done:* `pnpm build` now runs `scripts/check-runtime-deps.mjs`, which fails the build (and so the
image) when a server bundle imports a package that isn't a runtime dependency — the exact qrcode
failure. A container-level check that `/` returns 200 is still worth adding.

`qrcode` sat in `devDependencies` while the server bundle imported it at runtime, so the
runtime stage's `pnpm install --prod` omitted it and every page render returned 500. The
published v0.1.0, v0.1.1 and v0.2.0 images were all broken this way and nothing caught it:
vitest and Playwright both run against a dev install where every dependency is present, so
no test ever exercised what the Dockerfile actually ships.

Add a CI step that builds the image, runs it against a throwaway Postgres, and asserts `/`
returns 200 — not just `/health`, which stayed green throughout because it touches no
bundled application code.

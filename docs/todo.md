# Open items

Planned work and known gaps. Each entry says what is wanted or wrong and what doing it
involves. Nothing here blocks the MVP, which is complete and verified (see the README status
table).

- [Planned changes](#planned-changes) — requested work not yet started.
- [Known gaps](#known-gaps) — verified shortcomings in what already ships.


# Planned changes

Nothing currently queued here — the logo and English localisation both shipped. The QR/invite
feature and the shorter access phrase, requested earlier, also shipped and are described in
the git history rather than kept here.

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

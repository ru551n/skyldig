# Open items

Known, verified gaps. Each entry says what is wrong, why it is not urgent, and what fixing it
involves. Nothing here blocks the MVP, which is complete and verified (see the README status
table).

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

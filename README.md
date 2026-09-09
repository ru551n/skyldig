# Skyldig

## What it is

Skyldig is a self-hosted, account-free expense-splitting app: create a session, share an access
key, add expenses and payments, and see who owes whom. See `docs/architecture.md` for the full
design.

## Status

Phase 2 foundation: project scaffold, database schema/migrations, Express + React Router wiring,
health checks, lint/format/test tooling. No product features yet.

## Development quick start

No Docker required:

```sh
pnpm install
cp .env.example .env
pnpm dev:db      # starts an embedded Postgres on localhost:5432 (Ctrl-C to stop)
pnpm dev         # in another terminal; needs DATABASE_URL from .env
```

`pnpm dev` needs a running Postgres reachable at `DATABASE_URL`; `pnpm dev:db` runs one via
`embedded-postgres` with user/password/db all `skyldig`, matching `.env.example`.

## Tests

```sh
pnpm test:unit          # domain + server unit tests
pnpm test:integration    # against an embedded Postgres (downloads binaries on first run)
pnpm verify              # lint + typecheck + unit + integration
```

Integration tests use `TEST_DATABASE_URL` if set, otherwise start their own embedded Postgres
instance automatically (see `tests/integration/global-setup.ts`).

## Docker

```sh
cp .env.example .env   # fill in ACCESS_KEY_PEPPER, POSTGRES_PASSWORD, etc.
docker compose up --build
```

`compose.yaml` runs `postgres:17-alpine` plus the app container (multi-stage `Dockerfile`,
non-root, migrations run automatically on boot).

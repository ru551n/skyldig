# Skyldig — Architecture

Status: v1 — decided 2026-09-09 after independent review of credentials, money/multi-currency,
settlement/audit/concurrency and stack. Changes to this document are architecture decisions and
belong to the lead; implementers must not redefine them silently.

## 1. Requirements interpretation

Skyldig is a temporary, account-less shared-expense tracker. A *session* ("Japan 2026") owns
everything: participants, expenses, repayments, history, settlement. Access is by possession of
a Swedish word phrase (bearer credential); a separate admin key allows destructive operations.
Sessions expire 90 days after creation regardless of activity. Priorities: financial correctness,
data integrity, simplicity, security, maintainability, mobile UX, operational simplicity.

Non-goals for MVP: user accounts, weighted/exact splits (schema is ready for them), automatic FX
retrieval, real-time collaboration, session locking, languages other than Swedish (architecture
supports adding them).

## 2. Stack (pinned majors, verified 2026-09-09)

| Concern | Choice |
|---|---|
| Runtime | Node 24 LTS, TypeScript 5.9 (strict), pnpm 10 |
| Web framework | React Router 8 framework mode (SSR, loaders/actions) on Express 5, Vite 8 |
| UI | React 19, Tailwind CSS 4 (`@tailwindcss/vite`), `radix-ui` (Dialog), `motion` 13 |
| Database | PostgreSQL 17; `pg` driver; Drizzle ORM 0.45 + drizzle-kit SQL migrations (hand-reviewed; triggers/constraint triggers written as raw SQL in migration files) |
| Validation | Zod 4 (shared between forms and actions) |
| Security | helmet 8, built-in `crypto` (randomInt, randomBytes, HMAC, scrypt) |
| Logging | pino 10 with redaction |
| Tests | Vitest 4 (unit + integration projects), `embedded-postgres` 17 (real Postgres, no Docker/sudo needed), Playwright 1.63 (chromium) |
| Lint/format | ESLint 10 flat config + typescript-eslint 8, Prettier 3 |
| Containers | multi-stage Dockerfile on `node:24-alpine`, `compose.yaml` with `postgres:17-alpine` |

Why React Router over Next.js/TanStack Start: one plain Node process, no vendor coupling,
loaders/actions map 1:1 onto modules, cookies handled server-side, trivial single-container
self-hosting. Why Drizzle: explicit SQL migrations and schema-level constraints. Why
embedded-postgres: real Postgres semantics (locking, constraint triggers) in tests without Docker.

## 3. Repository structure and boundaries

```
skyldig/
  app/                    React Router app (client + SSR)
    routes/               route modules (loader/action/component)
    components/           ui/ primitives + feature components (client-safe only)
    i18n/                 sv.ts catalog, typed t(), useT()
    app.css               tailwind entry + design tokens
    root.tsx, routes.ts
  domain/                 PURE financial domain. Zero runtime deps. No framework, no DB, no I/O.
    money/                minor units, parse/format, rounding helpers
    currency/             ISO currency registry (decimals), rational exchange rates, conversion
    split/                largest-remainder split (weights; MVP uses equal weights)
    balances/             net balance per participant in base currency
    settlement/           settlement simplification
  server/                 Node-only. Never imported from app/components.
    config.ts, logger.ts
    db/                   drizzle schema, client, migrate.ts
    modules/session, auth, participants, expenses, payments, audit, expiration, balances
    http/                 express app, health endpoints, security headers
  server.js               production entry (express + migrations + cleanup job)
  drizzle/                SQL migrations
  tests/integration       Vitest against embedded Postgres
  tests/e2e               Playwright
  scripts/                wordlist check, helpers
  docs/
  Dockerfile, compose.yaml, .env.example
```

Import rules (ESLint `no-restricted-imports`): `domain/**` imports nothing outside itself;
`server/**` may import `domain/**`; `app/components/**` may import `domain/**` but never
`server/**`; routes import `server/**` only inside `loader`/`action` (React Router strips them
from the client bundle). Path aliases: `~/*` → `app/*`, `@domain/*`, `@server/*`.

`bigint` crosses the server→client boundary as decimal strings; loaders serialize via a
`serializeMoney` helper, and the client never does arithmetic except through `domain/` functions.

## 4. Credentials and browser sessions

### 4.1 Access phrase
- **4 words** drawn with rejection-sampled `crypto.randomInt` from a curated Swedish wordlist of
  ≥ 2048 words (`server/modules/session/wordlist.sv.txt`, validated by
  `scripts/check-wordlist.py`) → ≥ 44 bits. Shortened from 6 words on request, trading entropy
  for a phrase that is quicker to dictate; the join rate limits below were tightened to
  compensate, because a guess is tested against every active group at once through the blind
  index. See `docs/todo.md` for the full trade-off. Wordlist rules: lowercase ASCII a–z only (typeable
  on any keyboard; å/ä/ö words excluded), 3–8 letters, no prefix relationships, pairwise edit
  distance ≥ 2, no confusable inflections, nothing offensive.
- Format `w-w-w-w-w-w`. Input normalization: NFKC, trim, lowercase, replace any run of
  whitespace/`,`/`.`/`_`/`-`/`/` with a single hyphen, strip leading/trailing hyphens.
- Storage (two-stage): `sessions.access_key_index bytea UNIQUE` =
  HMAC-SHA256(`ACCESS_KEY_PEPPER`, normalized) for the indexed lookup, and
  `sessions.access_key_verifier text` = scrypt(normalized, 16-byte random salt, N=2^15, r=8,
  p=1, 32 bytes) stored as `scrypt$N$r$p$salt$hash`, verified with `timingSafeEqual`.
  A join is: normalize → index lookup → verifier check. The plaintext is never stored.
  The pepper is ≥ 32 bytes, lives in the environment (not the DB), and must be excluded from DB
  backups. `pepper_version smallint` is stored to allow future rotation.
- Uniqueness among active sessions: the UNIQUE index; on collision regenerate (never observed
  at 44 bits but handled).

### 4.2 Admin key
- 20 random bytes (160 bits) via `crypto.randomBytes`, Crockford-style base32 without
  0/O/1/I/L, grouped `admin-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx`.
- Stored as HMAC-SHA256(pepper, key) in `sessions.admin_key_hash`. Elevation is always
  **session-scoped**: `WHERE id = :sessionId AND admin_key_hash = :hash`.
- Shown once on the creation result page (rendered from the action response; never in a URL,
  cookie, or log). That page and the admin page send `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`.

### 4.3 Browser session and grants
- Successful join creates `browser_sessions(id, token_hash UNIQUE, created_at, last_seen_at,
  expires_at)`; cookie `__Host-skyldig` in production (`skyldig` in dev over http) holding
  32 random bytes base64url; `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=90d`. Only
  SHA-256(token) is stored.
- `session_grants(browser_session_id, session_id, role member|admin, created_at,
  last_used_at)`: one browser session may hold grants to several Skyldig sessions (landing page
  lists them).
- **Token rotation on every grant change** (join, elevation, leave): in one transaction insert
  the new browser session, move all grants to it, delete the old row, set the new cookie.
- Elevation: admin key entered on `/s/:sid/admin` → grant role `admin` for that session only.
- Admin actions: delete session, rotate access phrase (new index+verifier, revoke every other
  browser session's grant to this session), rotate admin key.
- Leave: delete the grant (rotate token); if none remain delete the browser session and clear
  the cookie (`Clear-Site-Data: "cookies"`).
- Sliding lifetime: `last_seen_at` refreshed at most once per hour; expired browser sessions
  are purged by the cleanup job.

### 4.4 Request protection
- CSRF: cookie SameSite=Lax **and** for every non-GET request: if `Sec-Fetch-Site` is present
  it must be `same-origin`; otherwise `Origin` must equal the configured `PUBLIC_ORIGIN`
  exactly; if neither is present → 403. There are no mutating GET routes.
- Rate limiting (`server/modules/auth/rate-limit.ts`): sliding-window counters in a bounded
  LRU (50k keys, fail-closed under eviction pressure). Client key = IPv4 address or IPv6 /64;
  `X-Forwarded-For` is honoured only when `TRUST_PROXY` is set. Limits: join 20/10 min and
  60/h per client, 240/h global. The per-client cap is deliberately loose because a whole
  group normally joins from one shared network; the global cap is what bounds brute force,
  and at 44.5 bits it leaves even a million live groups about a decade from an expected hit;
  invite-token redemption (§4.1, docs/todo.md) has its own identically sized limiter, kept
  separate from phrase joins because a token is single-use and short-lived and must not share
  a budget with a reusable credential; admin elevation 5/10 min per client **and** 20/h per session
  public id followed by a 15-minute lock. Failures return one generic message after a fixed
  ≥ 250 ms response floor.
- helmet: CSP `default-src 'self'` with a per-request nonce for the hydration script,
  `frame-ancestors 'none'`, HSTS in production, `Referrer-Policy:
  strict-origin-when-cross-origin`, nosniff. Body limit 64 KB.
- Public IDs: 16-char lowercase base32 random IDs (`sessions.public_id`, and for participants,
  expenses, payments). Internal bigint PKs never leave the server.
- Logging: pino `redact` on cookie/authorization headers and any `phrase`, `adminKey`, `token`,
  `password` field. Auth failures log client key and reason only.

## 5. Money and currency

- Amounts are integer minor units: `bigint` in TS, `bigint` (int8) in Postgres, decimal strings
  over the wire. `Money = { amountMinor: bigint; currency: CurrencyCode }`.
- Hard cap `amount_minor ≤ 10^15` (DB CHECK and parser), so all SQL stays within int8. **SQL
  never multiplies money**: conversion and splitting happen in TS `bigint` only; SQL only SUMs.
- Currency registry (`domain/currency`): ISO 4217 code → decimals (0–3) and Swedish name; the
  DB has a `currencies` table (code, decimals, name) with FKs from sessions/expenses/payments.
- Parsing: accepts `1 234,56`, `1.234,56`, `1234.56`, `1234`; rejects more decimals than the
  currency allows, negatives, zero. Formatting: `Intl.NumberFormat('sv-SE', {style:'currency'})`
  fed with a decimal string derived from minor units.

### 5.1 Multi-currency: locked conversion with rational rates (Option C)
- Session has an immutable `base_currency`.
- Non-base transactions store the rate **as entered** and **as an exact rational**:
  `rate_text varchar(32)` (what the user typed), `rate_direction` (`base_per_unit` = "1 EUR =
  11.45 SEK" or `units_per_base` = "1 SEK = 13.5 JPY"), `rate_num bigint`, `rate_den bigint`
  (both > 0, ≤ 10^15) meaning **1 unit of the transaction currency = rate_num/rate_den units of
  base**. E.g. `1 SEK = 150 JPY` → num=1, den=150; `0.0000734` base per unit → num=734,
  den=10^7.
- Conversion (TS bigint): `num = amount_minor × 10^baseDec × rate_num`,
  `den = 10^txDec × rate_den`, `base_amount_minor = (2·num + den) div (2·den)`
  (round half away from zero; all values positive). If the result is 0 the domain rejects the
  transaction as too small to represent in the base currency.
- `base_amount_minor` is computed at write time and re-derived only when amount/rate is edited
  by a user. Market rates never affect stored data.
- DB enforcement: `base_currency_code` is denormalized into expenses/payments with a composite
  FK to `sessions(id, base_currency)`, and `CHECK ((currency_code = base_currency_code AND
  rate_num IS NULL AND rate_den IS NULL AND base_amount_minor = amount_minor) OR (currency_code
  <> base_currency_code AND rate_num IS NOT NULL AND rate_den IS NOT NULL))`.
- UI: the form suggests the last rate used for that currency in the session. Per-person shares
  are always shown in base currency; the original amount is shown as a total (and as "≈" per
  person, never as an exact re-summing figure).

### 5.2 Splitting (largest remainder / Hamilton)
- `split(total: bigint, parts: {id, weight: bigint}[]) → shares` with
  `share_i = floor(total·w_i / Σw)` and the leftover units given one each to the largest
  fractional remainders, ties broken by participant `position` then id. With equal weights this
  is "floor, then +1 to the first `total mod n` participants in position order".
- Invariants: `Σ shares = total`, `max − min ≤ 1` for equal weights, deterministic regardless of
  input order, rejects empty participant lists.
- Splits are applied to `base_amount_minor`. Schema: `expenses.split_mode` (`'equal'` only for
  now), `expense_participants.weight_scaled bigint DEFAULT 1000000` and
  `share_base_minor bigint` stored per row. On any edit all rows are recomputed and replaced
  in one transaction. A deferred constraint trigger asserts `Σ share_base_minor =
  base_amount_minor` and `count ≥ 1` per expense.

### 5.3 Balances
`domain/balances`: for each participant `net = Σ paid(base) − Σ share_base_minor +
Σ repayments made(base) − Σ repayments received(base)`. Positive = is owed. Invariant
`Σ net = 0` holds exactly. A repayment in a foreign currency may leave a small residual; that is
correct behaviour and is surfaced, not hidden.

## 6. Settlement

`domain/settlement`: input = `{participantId, position, net}[]` with `Σ net = 0` (throws
otherwise); output = ordered `{from, to, amountMinor}[]`.
1. Exact-match pre-pass iterated to a fixed point: whenever a debtor's debt equals a creditor's
   credit, pair them (deterministic by position).
2. Greedy: repeatedly match the largest remaining debtor with the largest remaining creditor
   (ties by position), transfer `min`, drop whoever reaches zero.
Properties: exactly correct (applying the transfers zeroes all nets), ≤ n−1 transfers,
deterministic. Plans are advisory, recomputed on demand, never persisted (a 1-unit change can
reshape the plan; the UI presents it as "suggested").

## 7. Audit and concurrency

- `revisions(id, session_id FK CASCADE, entity_type expense|payment|participant, entity_id
  bigint, revision_no int, action created|updated|deleted, snapshot jsonb, created_at,
  UNIQUE(entity_type, entity_id, revision_no))`, index `(session_id, created_at DESC)`.
- Every mutation writes a **post-state snapshot** in the same transaction; deletes snapshot the
  last known state. Snapshots are self-contained and use public ids + display names at the time:
  expense = `{publicId, description, amountMinor, currencyCode, rateText, rateDirection,
  baseAmountMinor, expenseDate, note, payer:{publicId, displayName},
  participants:[{publicId, displayName, shareBaseMinor}]}`.
- Optimistic concurrency: expenses, payments and participants carry `revision int`. Forms
  carry the expected revision in a hidden field. Update = `UPDATE … SET revision = revision+1
  WHERE id=$1 AND revision=$expected RETURNING *`; delete = `DELETE … WHERE id=$1 AND
  revision=$expected RETURNING *`; 0 rows → 409 with the current state so the UI can show what
  changed. `revision_no` = the returned revision (create → 1, delete → expected+1). Unique
  violations (23505) on participant names map to a friendly validation error.
- Deleted items appear in the activity view from `revisions`.

## 8. Expiration

- `expires_at` is set in SQL: `now() + interval '90 days'`; never updated by viewing/editing.
- Every session lookup filters `expires_at > now()` (database clock), so expired data is
  unreachable before cleanup runs.
- Cleanup job (`server/modules/expiration`): runs at startup (after migrations) and hourly via
  `setInterval` inside the app process, guarded by `pg_try_advisory_lock` (single flight across
  replicas), deleting in batches of 200 (`… WHERE id IN (SELECT id FROM sessions WHERE
  expires_at < now() ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED)`) until none remain, then
  purging expired `browser_sessions`. Errors are caught and logged, never crash the timer.
  Also runnable as `pnpm cleanup` for an external scheduler. Rejected: pg_cron (extension),
  separate worker container (overkill).

## 9. Data model

```
currencies(code PK, decimals smallint CHECK 0..3, name_sv text)
sessions(id bigserial PK, public_id text UNIQUE, name text CHECK length 1..80,
         base_currency FK currencies, access_key_index bytea UNIQUE, access_key_verifier text,
         admin_key_hash bytea, pepper_version smallint, created_at, expires_at,
         UNIQUE(id, base_currency))
participants(id bigserial PK, public_id UNIQUE, session_id FK CASCADE, display_name text,
         normalized_name text, position int, revision int, created_at, updated_at,
         UNIQUE(session_id, normalized_name), UNIQUE(session_id, position), UNIQUE(id, session_id))
expenses(id bigserial PK, public_id UNIQUE, session_id FK CASCADE, description text,
         amount_minor bigint CHECK 0 < x <= 1e15, currency_code FK, base_currency_code,
         rate_text, rate_direction, rate_num, rate_den, base_amount_minor bigint CHECK > 0,
         split_mode CHECK ('equal'), payer_id, expense_date date, note text, revision int,
         created_at, updated_at,
         FK (session_id, base_currency_code) → sessions(id, base_currency),
         FK (payer_id, session_id) → participants(id, session_id) ON DELETE RESTRICT,
         UNIQUE(id, session_id), CHECK (base/rate consistency, §5.1))
expense_participants(expense_id, session_id, participant_id, weight_scaled bigint CHECK > 0,
         share_base_minor bigint CHECK >= 0, PK(expense_id, participant_id),
         FK (expense_id, session_id) → expenses(id, session_id) ON DELETE CASCADE,
         FK (participant_id, session_id) → participants(id, session_id) ON DELETE RESTRICT)
payments(… same money columns as expenses …, payer_id, recipient_id, payment_date,
         CHECK payer_id <> recipient_id, composite FKs to participants RESTRICT)
revisions(…, §7)
browser_sessions(id bigserial, token_hash bytea UNIQUE, created_at, last_seen_at, expires_at)
session_grants(browser_session_id FK CASCADE, session_id FK CASCADE, role, created_at,
         last_used_at, PK(browser_session_id, session_id))
```
Participants referenced by expenses/payments cannot be deleted (RESTRICT); the UI offers rename
always and delete only when unreferenced. Indexes on `(session_id)` for all child tables.

## 10. UI structure (routes)

```
/                        landing: Create / Join; sessions this browser has joined
/new                     create session (name, base currency, initial participants)
                         → same route renders the result (phrase, admin key, expiry) from the action
/join                    join form (paste-friendly)
/s/:sid                  dashboard: settle-up summary, balances, recent activity, action bar
/s/:sid/expenses/new     add expense
/s/:sid/expenses/:eid    detail + history; /edit
/s/:sid/payments/new     add repayment; /s/:sid/payments/:pid (+ /edit)
/s/:sid/participants     list / add / rename
/s/:sid/activity         chronological feed incl. deleted items
/s/:sid/settle           settlement plan + balance details
/s/:sid/admin            elevate, rotate keys, delete session
/s/:sid/leave (POST)     remove grant
/health, /ready          express (process up / DB reachable)
```
Forms are routes (deep-linkable, back-button friendly). Confirmation dialogs only for deletes.
Mobile: bottom action bar; ≥ md: two-column shell. Animations via `motion` inside
`<MotionConfig reducedMotion="user">`; no layout animations on money-affecting forms.

## 11. Localization
`app/i18n/sv.ts` is a typed catalog; `t(key, params)` is typed on the catalog keys; locale comes
from root context (`sv` only for now). Dates/currency via `Intl` with the locale.

## 12. Testing
- Unit (Vitest project `unit`): `domain/**` incl. property-style loops for Σ shares, Σ net = 0,
  settlement resolution/determinism, rational-rate conversion vs exact reference, rounding
  boundaries, parser cases, 0/2/3-decimal currency pairings.
- Integration (Vitest project `integration`, embedded Postgres started once in globalSetup,
  schema migrated, tables truncated between tests): session create/join/elevate/rotate/leave,
  rate limiting, participant uniqueness/rename conflicts, expense & payment CRUD with revisions
  and 409s, constraint-trigger enforcement, expiration cleanup, health endpoints.
- E2E (Playwright, chromium): the 12-step flow from the brief, plus reduced-motion smoke.
- `pnpm verify` = lint + typecheck + unit + integration.

## 13. Observability
pino JSON logs (pretty in dev) with request id and redaction; `/health` and `/ready`; startup
diagnostics with secrets redacted; generic Swedish error page for unhandled errors.

## 14. Docker
Multi-stage Dockerfile (deps → build → runtime `node:24-alpine`, non-root); entrypoint runs
migrations then starts the server; `compose.yaml`: `db` (postgres:17-alpine, named volume,
`pg_isready` healthcheck) and `app` (`depends_on: condition: service_healthy`, `/health`
healthcheck, `restart: unless-stopped`). Config via env only: `PORT`, `DATABASE_URL`,
`ACCESS_KEY_PEPPER`, `PUBLIC_ORIGIN`, `TRUST_PROXY`, `LOG_LEVEL`, `NODE_ENV`.

## 15. Roadmap
Phase 2 foundation → 3 financial domain → 4 session/auth → 5 modules → 6 UI workflows →
7 polish → 8 ops → 9 hardening. Each phase: delegate → implement → inspect → test → commit.

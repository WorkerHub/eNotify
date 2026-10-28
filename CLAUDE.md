# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (run from root)
pnpm install

# Start both frontend and backend in development
pnpm dev

# Start individually
pnpm dev:web      # Vite dev server (React)
pnpm dev:worker   # Wrangler dev server (Cloudflare Workers)

# Build
pnpm build        # Build both web and worker
pnpm build:web
pnpm build:worker

# Type checking
pnpm typecheck    # Check both packages

# Run worker tests (Vitest)
pnpm test

# Deploy (builds web, then deploys worker with assets)
pnpm deploy
```

## Architecture

This is a **pnpm monorepo** with two packages:

- `web/` — React 19 SPA (Vite + Tailwind CSS v4 + shadcn/ui)
- `worker/` — Cloudflare Workers backend (Hono.js)

The worker serves the frontend's static assets from `web/dist/` via the `ASSETS` binding. There is no separate API server; the single Cloudflare Worker handles both the API (`/api/*`) and SPA fallback.

### Backend (`worker/`)

**Entry point**: `worker/src/index.ts` — registers all Hono routes, the `/_waker` callback mount (before the SPA fallback) and the native scheduled handler.

**Route structure** (`worker/src/routes/`):

- `auth.ts` — registration, login, logout, email verification
- `auth2fa.ts` — TOTP, Passkey (WebAuthn), email OTP
- `me.ts` — user profile, notification settings
- `items.ts` — CRUD for items (notifications) and payment history; routes at `/api/items`
- `dashboard.ts` — spending stats, expiry summary
- `admin.ts` — user management, system settings; also manages items per user at `/api/admin/users/:uid/items`
- `notify.ts` — manual notification test trigger
- `waker.ts` — `/_waker` mount for the waker callback receiver (SDK paths, signature and idempotency only; mounted before `app.get("*")` so a callback can never be answered with 200 HTML)
- `setup.ts` — one-time DB initialization via `SETUP_SECRET` (rate-limited, 3/10min per IP); also exposes `GET /api/setup/state` (public setup-page toggle) and `POST /api/admin/setup` (admin-only, no secret). Core setup/migration logic lives in `worker/src/lib/setup.ts`. `runSetup` is a three-branch state machine after the prefix guard: ledger present → apply unrecorded migrations; no ledger but business tables present → pre-ledger in-place transition (legacy patches → shape verification → stamp `schema_v1`); neither → fresh install through the ledger.

**Database** (`worker/src/db/`):

- Cloudflare D1 (SQLite). `worker/src/db/schema.sql` is the readable full schema (used by tests); the runtime source of truth is the migration list below.
- **Migrations are ledger-based.** The ordered list lives in `worker/src/lib/migrations.ts` (`getMigrations(prefix)`: `schema_v1` = the whole schema at ledger introduction, `schema_v2` = notification-history `trigger_source`, `schema_v3` = `{prefix}waker_executions` + `{prefix}scheduler_tick_claims`); `worker/src/lib/migrations-runner.ts` applies the not-yet-recorded ones in order and records each name in the ledger, throwing on the first failure (a migration is recorded only after all of its statements succeeded). Append new migrations only at the END of the list as `schema_vN`; never rename, edit or reorder a merged migration; migrations must be additive (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN`, `INSERT OR IGNORE` — no `DROP`/`RENAME`/data rewrites); migration SQL string literals must not contain `;` (the runner splits on `;` and runs the statements one by one).
- The ledger table name is built only by `migrationsTable()`: `_` + prefix core (trailing `_` stripped, case preserved) + `_schema_migrations`, i.e. `_enotify_schema_migrations` for the default prefix and `_schema_migrations` with no prefix. Ledger tables are not part of the eNotify table family and are ignored by `detectTablePrefixes()` (other projects' ledgers coexist in a shared D1).
- Transitioning a pre-ledger database, production cutover and rollback: `docs/migration-ledger-cutover-runbook.md`.
- All table names use a `{prefix}` placeholder at definition time, resolved at runtime via `TABLE_PREFIX` env var and the `getTablePrefix()` helper in `types.ts` (the ONLY resolution point). Three states: unset/null → default `enotify` (`enotify_`); custom non-empty value → verbatim with trailing `_`; explicit `""` → no prefix. `runSetup` in `worker/src/lib/setup.ts` detects existing initialized schemas under other prefixes via `detectTablePrefixes()` and aborts with 409 `PREFIX_CONFLICT` instead of silently re-initializing; CI maps unset/empty vars to `enotify` and the reserved word `none` to `""`.
- Query functions are organized by entity in `worker/src/db/queries/`. Key entities: `items`, `payments`, `users`, `notifications` (channel config), `settings`.

**Core utilities** (`worker/src/core/`):

- `auth.ts` — JWT signing/verification, password hashing, ID generation
- `time.ts` — timezone-aware date arithmetic, period calculations
- `lunar.ts` — Chinese lunar calendar support (1900–2100)
- `currency.ts` — multi-currency / exchange rate conversion

**Notification services** (`worker/src/services/notify/`): Each channel (Telegram, Webhook, Email, Bark, Slack, Feishu, Discord, WeChatBot) is a separate file. `index.ts` sends to selected enabled channels via the `channels` parameter, or only to the user's default channel when no channels are selected.

**Scheduler** (`worker/src/services/scheduler.ts`): Runs hourly. For each active user it:

1. Checks their allowed notification hours (per-timezone).
2. Auto-renews expired items (with KV deduplication).
3. Sends reminders for items expiring within the user's configured threshold (with per-hour KV deduplication). If an item has specific channels configured (`channels` column), only those channels are used; otherwise only the user's default channel receives the notification.

`services/scheduler.ts` is the single business implementation. Both schedule entries go through `services/scheduler-tick.ts` `runSchedulerTick(env, { source, scheduledFor })`:

- **native entry**: `scheduled()` in `index.ts`, `source: "cron"`, `scheduledFor: event.scheduledTime` (awaited, not `waitUntil`);
- **waker entry**: `services/waker-callback.ts`, job `hourly-reminder-sweep`, `source: "waker"`, `scheduledFor: ctx.scheduledFor`; mounted at `/_waker` by `routes/waker.ts` using the verbatim SDK copy in `worker/src/waker/` (waker-client 2.0.0 — never hand-edit that directory).

The guard in front of the business pass is one atomic D1 claim per UTC hour (`{prefix}scheduler_tick_claims`, `INSERT … ON CONFLICT(tick_key) DO NOTHING` + `meta.changes`), so cron and waker can never sweep the same hour twice; the SDK's own `{prefix}waker_executions` ledger dedupes executionId retries. Failure semantics: cron keeps the claim on failure (no re-run that could double-send), waker releases it and rethrows so the platform retry (same executionId) completes the hour. Claims are pruned after 7 days.

Waker is optional and the **only** setting is `WAKER_SIGNING_KEY` (GitHub Secret → `wrangler deploy --secrets-file`): unset/blank/`*_PLACEHOLDER` means native cron only. The gate is `wakerSigningKey()` in `services/scheduler-tick.ts`; the receiver stays mounted and fails closed with 500 JSON `signing_key_missing`. Do not reintroduce `WAKER_MODE`/`WAKER_URL`/project tokens — the SDK's `mountWakerReceiver`, `createWakerClient*`, `syncManifest` and `resolveWakerMode` must stay uncalled.

**Cloudflare bindings**:

- `DB` — D1 database
- `KV` — KV namespace (used for scheduler deduplication and status)
- `ASSETS` — static file serving
- Secrets: `JWT_SECRET`, `SETUP_SECRET`, and optional `WAKER_SIGNING_KEY` (empty ⇒ native cron only)
- Env var: `TABLE_PREFIX` (three states: unset → default `enotify`, tables like `enotify_users`; custom value → verbatim with trailing `_`; explicit `""`/CI `none` → no prefix; allows shared DB with prefix isolation)

### Frontend (`web/`)

**Entry point**: `web/src/main.tsx`

**Routing** (React Router v7): Auth pages, dashboard, item list/detail/new (`/items/*`), channels (`/channels`), settings, admin pages.

**API communication**: `web/src/lib/api.ts` — thin wrapper over `fetch` for the backend API.

**i18n**: `react-i18next` with `zh.json` / `en.json` locale files in `web/src/locales/`. Language auto-detected from browser. The `items` namespace covers notification management UI strings; `nav.items` is the nav label. The `channels` namespace covers channel management UI strings.

**Auth state**: `web/src/hooks/useAuth.tsx` — provides user context and JWT-based auth throughout the app.

### Naming conventions

- **Code/DB/API**: uses `item` / `Item` / `items` (table: `${prefix}items`, routes: `/api/items`)
- **UI (zh)**: shows "通知" / "通知管理"
- **UI (en)**: shows "Notification" / "Notifications"
- **`notification_config`** / `NotificationConfig` refers to push channel configuration, not items — these are separate concepts.
- **Code/UI for channels**: `channels` / `Channel` in code and nav. DB column `channels` on items stores a JSON array of channel IDs (e.g. `["telegram","email"]`). Empty array `[]` means "use the default channel".
- **UI (zh)**: shows "渠道" / "渠道管理"
- **UI (en)**: shows "Channel" / "Channel Management"

### Tailwind CSS v4 notes

- Uses `@theme inline` in `web/src/index.css` to map shadcn/ui CSS variables (`--primary` etc.) to Tailwind color tokens (`--color-primary`).
- Toggle thumb vertical centering: use `top-[calc(50%-8px)]` instead of `top-1/2 -translate-y-1/2` to avoid conflict with horizontal `translate-x-*` (Tailwind v4 uses CSS `translate` shorthand — two translate classes on the same element override each other).

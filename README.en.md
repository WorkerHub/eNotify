# eNotify

[中文](./README.md) | English

A smart notification management system that helps you track expiry dates and expenses, sending reminders through multiple channels.

## Features

- **Multi-user** — Registration/login, first user becomes admin automatically
- **Notification Management** — Add, edit, renew, deactivate, with cycle/reset modes, regular and subscription types
- **Auto-renewal** — Expired subscriptions are automatically renewed with payment history recorded
- **Payment History** — Record every payment, multi-currency with real-time exchange rates
- **Dashboard** — Monthly/yearly expense stats, expiry alerts, category analysis
- **8 Notification Channels** — Telegram, Webhook, WeChat Work, Email, Bark, Slack, Feishu, Discord
- **Channel Management** — Dedicated page to enable and configure notification channels
- **Per-Item Channel Selection** — Each notification item can select multiple channels; if unset, only the default channel is used
- **Scheduled Reminders** — Hourly auto-check with global notification hours and per-item override
- **Notification History** — View all sent notifications with delivery status
- **Two-Factor Auth** — TOTP (authenticator app), Email OTP, Passkey
- **Password Reset** — Reset password via email verification code
- **Admin Panel** — User management, system settings, user impersonation
- **Lunar Calendar** — Lunar date display and period calculation (1900-2100)
- **Theme Switching** — Light/Dark/System
- **Bilingual** — Chinese/English
- **Mobile-First** — Responsive design with top bar and bottom navigation

## Tech Stack

- **Backend**: Cloudflare Workers + Hono.js (TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui
- **Deployment**: GitHub Actions + Wrangler

## Deployment Guide

### Prerequisites

- Cloudflare account
- GitHub repository
- Node.js >= 22
- pnpm

### 1. Create Cloudflare Resources

```bash
# Create D1 database
npx wrangler d1 create enotify-db

# Create KV namespace
npx wrangler kv namespace create ENOTIFY_KV
```

### 2. Configure GitHub Secrets

In your repository Settings → Secrets and variables → Actions, add:

| Secret                 | Description                                             |
| ---------------------- | ------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (needs Workers and D1 permissions) |
| `JWT_SECRET`           | Any random 64-char string — e.g. `openssl rand -hex 32` |
| `SETUP_SECRET`         | Any random string — e.g. `openssl rand -hex 16`         |
| `WAKER_SIGNING_KEY`    | **Optional** waker callback signing key; leave unset to stay on native cron (see "Waker Scheduling") |

In Settings → Secrets and variables → Actions → Variables, add:

| Variable           | Description                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `D1_DATABASE_NAME` | D1 database name                                                                                         |
| `D1_DATABASE_ID`   | D1 database ID                                                                                           |
| `KV_NAMESPACE_ID`  | KV namespace ID                                                                                          |
| `TABLE_PREFIX`     | Table prefix, three states: unset/empty → default `enotify` (tables like `enotify_users`); `none` → no prefix; other values (e.g. `eNotify`) → verbatim |

### 3. Deploy

Push to `main` branch to trigger automatic deployment.

### 4. Initialize Database

After deployment, initialize the database with a POST request (the secret goes in a header so it never appears in the URL, browser history, or access logs):

```bash
curl -X POST https://your-worker.workers.dev/api/setup \
  -H "X-Setup-Secret: <SETUP_SECRET>"
```

You can call it again after each upgrade/deploy to run database migrations (migrations run automatically when the database is already initialized).

> The old `GET /api/setup/<SETUP_SECRET>` URL is deprecated and returns 405. If you ever visited that URL against a deployment, rotate `SETUP_SECRET`, since the secret may have leaked into browser history or access logs.

`POST /api/setup` is rate-limited per source IP: at most 3 requests per 10 minutes, returning `429` beyond that.

The setup page is gated by the `setup_page_enabled` system setting (`'0'` disabled / `'1'` enabled, default `'1'`), editable from the admin panel. It **only affects the setup page** — `POST /api/setup` works regardless of the toggle. The frontend can query the public `GET /api/setup/state` endpoint (no auth) for `{"enabled": true|false}` (returns `true` when not initialized).

A logged-in admin can also run initialization/migrations directly via `POST /api/admin/setup`, without `SETUP_SECRET` (the setup page is provided by the frontend).

### 5. Register Admin

Visit the app homepage and register an account. The first registered user will automatically become the admin.

## Local Development

```bash
# Install dependencies
pnpm install

# Start development (frontend + backend)
pnpm dev

# Frontend only
pnpm dev:web

# Backend only
pnpm dev:worker
```

## API Keys (for external programs)

External programs (AI assistants, scripts) can call the item management API `/api/items/*` and the push trigger endpoint `/api/notify` with an API key instead of a cookie session. A key has the same permissions as the user who created it. Only `/api/items` and `/api/notify` accept API keys for now; every other endpoint (including key management itself) still requires a login session.

> Day-to-day management is available in the web UI under **Settings → API Keys**: create, copy, list and revoke. The curl examples below are for scripting and troubleshooting.

**1. Create** (requires a logged-in cookie session)

```bash
curl -X POST https://your-worker.workers.dev/api/me/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: access_token=<access_token after login>" \
  -d '{"name": "my-assistant", "expires_in_days": 90}'
```

`name` is required (1-50 chars); `expires_in_days` is optional, 1-3650, default 365. At most 20 keys per user. The `key` in the response (`enk_...`) is shown **only once**; the server stores just its SHA-256 hash, so a lost key must be regenerated.

**2. Use**

```bash
curl https://your-worker.workers.dev/api/items \
  -H "Authorization: Bearer enk_xxxxxxxx"

curl -X POST https://your-worker.workers.dev/api/notify \
  -H "Authorization: Bearer enk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"title": "Reminder", "body": "Content", "url": "https://example.com"}'

# Send only to Telegram and Bark
curl -X POST https://your-worker.workers.dev/api/notify \
  -H "Authorization: Bearer enk_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"title": "Reminder", "body": "Content", "channels": ["telegram", "bark"]}'
```

`POST /api/notify` accepts an optional `channels` array to select multiple channels. If omitted or empty, only the user's default channel is used. Unknown or disabled channels, and requests without channels when no default is configured, return 400 without sending. `title` defaults to `Notification` when omitted. Besides the API key, it also accepts a cookie login session.

Each key is limited to 120 requests/minute (`429` beyond that). Invalid, expired or revoked keys get `401`; keys stop working as soon as their user is disabled. `/api/notify` has an additional per-IP limit of 30 requests/minute.

The legacy notify token (`/api/notify/<token>`) is retired and returns `410`; use an API key with `POST /api/notify` instead.

**3. List and revoke** (also requires a login session)

```bash
# List (no plaintext; includes last_used_at, updated at most every ~5 minutes)
curl https://your-worker.workers.dev/api/me/api-keys -H "Cookie: access_token=..."

# Revoke, effective immediately
curl -X DELETE https://your-worker.workers.dev/api/me/api-keys/<id> -H "Cookie: access_token=..."
```

## Environment Variables

### Worker Environment Variables

`JWT_SECRET` and `SETUP_SECRET` are Secrets, uploaded by GitHub Actions via `wrangler deploy --secrets-file`. For local deploys, run `wrangler secret put JWT_SECRET` (and `SETUP_SECRET`) first. `TABLE_PREFIX` is injected into wrangler.toml.

`TABLE_PREFIX` has three-state semantics (resolved solely by the `getTablePrefix()` helper in `worker/src/types.ts`):

- **Unset** (not configured / `null`) → default prefix `enotify`, actual table names like `enotify_users`;
- **Custom non-empty value** (e.g. `eNotify`) → used verbatim with a trailing `_` appended (`eNotify_`); only letters, digits and underscores are allowed;
- **Explicit empty string `""`** → no prefix at all (table names like `users`).

CI deployment convention (`.github/workflows/deploy.yml`): a GitHub Variables `TABLE_PREFIX` that is unset or empty → injects `enotify`; the reserved word `none` → injects the empty string (no prefix); any other value → injected verbatim. This matches the runtime three-state resolution.

> ⚠️ **Upgrade warning**: older deployments that never configured `TABLE_PREFIX` (the old default was no prefix) must explicitly set `TABLE_PREFIX=none` in GitHub Variables before upgrading, in order to keep the existing unprefixed table names. Otherwise the setup/migration endpoints (`POST /api/setup`, `POST /api/admin/setup`) detect the conflict between the legacy unprefixed schema and the new default prefix `enotify_` and abort with 409 `PREFIX_CONFLICT` — they never re-create or silently switch tables. Deployments already using a custom value (e.g. `eNotify`) are unaffected.

| Variable       | Description                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`   | JWT signing secret, any random 64-char string                                                            |
| `SETUP_SECRET` | Database initialization route secret, any random string                                                  |
| `TABLE_PREFIX` | Table prefix, three states: unset → default `enotify` (tables like `enotify_users`); explicit empty string / CI `none` → no prefix; custom value → verbatim with trailing `_` |
| `WAKER_SIGNING_KEY` | Optional. Waker callback signing key; missing / blank / `*_PLACEHOLDER` means unconfigured → native cron only |

## Waker Scheduling (optional)

By default the hourly reminder sweep runs on the native Cloudflare Cron Trigger (`[triggers]` in `worker/wrangler.toml`, `0 * * * *` UTC). It can also be driven by the [waker](https://github.com/WorkerHub/waker) platform: **the only setting is `WAKER_SIGNING_KEY`** — leave it unset and the default cron keeps running; set it and both entries coexist, arbitrated by an hourly claim, so nothing is sent twice.

> Signature verification, the timestamp window and executionId idempotency come from the official SDK source copy (`worker/src/waker/`, `@workerhub/waker-client` 2.0.0). That directory must not be edited by hand.

### 1. Configure the signing key (optional)

Add the GitHub Secret `WAKER_SIGNING_KEY` (value = the signing key the waker console shows **once** when the project is created; keep a copy in your password manager first). At deploy time it is only written to `$RUNNER_TEMP/secrets.json` (0600) and uploaded via `wrangler deploy --secrets-file`; CI logs only `configured` / `not configured`, **never the value**.

Empty, whitespace-only, `undefined` and `*_PLACEHOLDER` values are all treated as "not configured". In that state the receiver is still mounted but fails closed: a real callback gets **500 JSON `signing_key_missing`**, a request without signature headers gets 400, and `GET /_waker/execute` gets 404 — it **never falls through to the SPA's 200 HTML**, never queries the DB, writes the ledger or runs business code. Deploying without the key always succeeds.

### 2. Create the job in the waker console

Create a project `eNotify` (callback URL = your production domain; the platform appends `/_waker/execute`), then one declarative job:

| Field | Value |
| --- | --- |
| Job name | `hourly-reminder-sweep` (must match `WAKER_JOB_NAME` in the code verbatim, otherwise the callback gets 404 `unknown_job`) |
| Kind | cron |
| Cron | `0 * * * *` |
| Timezone | `UTC` |
| Payload | `{}` |
| Misfire | `fire_once` |
| Concurrency | `forbid` |
| maxRetries | `2` |
| backoffSeconds | `30` |
| timeoutSeconds | `300` |
| jitterSeconds | `0` |
| enabled | `true` |

There is no registration client, project token, dynamic registration/cancellation or self-renewal in this repo: the job is maintained in the console only. The handler **awaits the business pass** before answering 2xx; failures are retried by the platform and the same executionId never runs twice.

### 3. Database migration

`schema_v3` adds two tables under the configured table prefix (default `enotify_waker_executions`, `enotify_scheduler_tick_claims`): the SDK's executionId idempotency ledger and the hourly claim table. After upgrading, call `POST /api/setup` once (or use "check and upgrade database" in the admin UI); migrations are additive and re-runnable. If the key is configured while the claim table does not exist yet, **both** entries stop safely (no double-send wins), so migrate before configuring the key.

### 4. Dual run, cutover and disabling

- **Dual run**: while `[triggers]` stays, both entries exist. Each UTC hour exactly one of them wins the D1 claim and runs the sweep; the other one skips (the waker side answers `duplicate_tick`), so no notification or renewal happens twice. Claim rows are kept for 7 days for troubleshooting.
- **Cut over to waker only**: first confirm exactly one claim row per hour (`SELECT tick_key, source, claimed_at FROM enotify_scheduler_tick_claims ORDER BY claimed_at DESC LIMIT 6`), then delete `[triggers]` from `worker/wrangler.toml` and deploy. CI interlocks: deploying with no `[triggers]` and no `WAKER_SIGNING_KEY` fails outright (otherwise nothing would run at the top of the hour).
- **Disable callbacks**: `wrangler deploy --secrets-file` is additive (omitting a key does not delete the old value). Restore `[triggers]`, deploy, and explicitly run `npx wrangler secret delete WAKER_SIGNING_KEY`. Even if you forget, the hourly claim still prevents duplicate runs.
- **Rotate the key**: rotate in the waker console → the old key stops working immediately → update the GitHub Secret `WAKER_SIGNING_KEY` → redeploy. Callbacks during the window are rejected (401) and retried by the platform.

## License

[MIT](LICENSE)

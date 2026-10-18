# eNotify

[中文](./README.md) | English

A smart notification management system that helps you track expiry dates and expenses, sending reminders through multiple channels.

## Features

- **Multi-user** — Registration/login, first user becomes admin automatically
- **Notification Management** — Add, edit, renew, deactivate, with cycle/reset modes, regular and subscription types
- **Auto-renewal** — Expired subscriptions are automatically renewed with payment history recorded
- **Payment History** — Record every payment, multi-currency with real-time exchange rates
- **Dashboard** — Monthly/yearly expense stats, expiry alerts, category analysis
- **9 Notification Channels** — Telegram, Webhook, WeChat Work, Email, Bark, Gotify, ServerChan, PushPlus, NotifyX
- **Channel Management** — Dedicated page to enable and configure notification channels
- **Per-Item Channel Selection** — Each notification item can specify which channels to use; defaults to all enabled channels if unset
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

In Settings → Secrets and variables → Actions → Variables, add:

| Variable           | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `D1_DATABASE_NAME` | D1 database name                                      |
| `D1_DATABASE_ID`   | D1 database ID                                        |
| `KV_NAMESPACE_ID`  | KV namespace ID                                       |
| `TABLE_PREFIX`     | Optional prefix for all DB table names(e.g. `myapp_`) |

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
```

`POST /api/notify` sends a push to the user's enabled notification channels; `title` defaults to `Notification` when omitted. Besides the API key, it also accepts a cookie login session.

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

| Variable       | Description                                             |
| -------------- | ------------------------------------------------------- |
| `JWT_SECRET`   | JWT signing secret, any random 64-char string           |
| `SETUP_SECRET` | Database initialization route secret, any random string |
| `TABLE_PREFIX` | Database table prefix (e.g., `hk_`), default is empty   |

## License

[MIT](LICENSE)

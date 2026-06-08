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

# Deploy (builds web, then deploys worker with assets)
pnpm deploy
```

No test suite exists in this project.

## Architecture

This is a **pnpm monorepo** with two packages:

- `web/` — React 19 SPA (Vite + Tailwind CSS v4 + shadcn/ui)
- `worker/` — Cloudflare Workers backend (Hono.js)

The worker serves the frontend's static assets from `web/dist/` via the `ASSETS` binding. There is no separate API server; the single Cloudflare Worker handles both the API (`/api/*`) and SPA fallback.

### Backend (`worker/`)

**Entry point**: `worker/src/index.ts` — registers all Hono routes and the scheduled handler.

**Route structure** (`worker/src/routes/`):

- `auth.ts` — registration, login, logout, email verification
- `auth2fa.ts` — TOTP, Passkey (WebAuthn), email OTP
- `me.ts` — user profile, notification settings
- `items.ts` — CRUD for items (notifications) and payment history; routes at `/api/items`
- `dashboard.ts` — spending stats, expiry summary
- `admin.ts` — user management, system settings; also manages items per user at `/api/admin/users/:uid/items`
- `notify.ts` — manual notification test trigger
- `setup.ts` — one-time DB initialization via `SETUP_SECRET`

**Database** (`worker/src/db/`):

- Cloudflare D1 (SQLite). Schema defined in `worker/src/db/schema.sql`.
- All table names use a `{prefix}` placeholder at definition time, resolved at runtime via `TABLE_PREFIX` env var and the `getTablePrefix()` helper in `types.ts`.
- Query functions are organized by entity in `worker/src/db/queries/`. Key entities: `items`, `payments`, `users`, `notifications` (channel config), `settings`.

**Core utilities** (`worker/src/core/`):

- `auth.ts` — JWT signing/verification, password hashing, ID generation
- `time.ts` — timezone-aware date arithmetic, period calculations
- `lunar.ts` — Chinese lunar calendar support (1900–2100)
- `currency.ts` — multi-currency / exchange rate conversion

**Notification services** (`worker/src/services/notify/`): Each channel (Telegram, Webhook, Email, Bark, Gotify, ServerChan, PushPlus, NotifyX, WeChatBot) is a separate file. `index.ts` fans out to all enabled channels, with optional per-item channel filtering via the `channels` parameter.

**Scheduler** (`worker/src/services/scheduler.ts`): Runs hourly via Cloudflare Cron Trigger (`0 * * * *`). For each active user it:

1. Checks their allowed notification hours (per-timezone).
2. Auto-renews expired items (with KV deduplication).
3. Sends reminders for items expiring within the user's configured threshold (with per-hour KV deduplication). If an item has specific channels configured (`channels` column), only those channels are used; otherwise all enabled channels receive the notification.

**Cloudflare bindings**:

- `DB` — D1 database
- `KV` — KV namespace (used for scheduler deduplication and status)
- `ASSETS` — static file serving
- Secrets: `JWT_SECRET`, `SETUP_SECRET`
- Env var: `TABLE_PREFIX` (optional, allows shared DB with prefix isolation)

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
- **Code/UI for channels**: `channels` / `Channel` in code and nav. DB column `channels` on items stores a JSON array of channel IDs (e.g. `["telegram","email"]`). Empty array `[]` means "use all enabled channels".
- **UI (zh)**: shows "渠道" / "渠道管理"
- **UI (en)**: shows "Channel" / "Channel Management"

### Tailwind CSS v4 notes

- Uses `@theme inline` in `web/src/index.css` to map shadcn/ui CSS variables (`--primary` etc.) to Tailwind color tokens (`--color-primary`).
- Toggle thumb vertical centering: use `top-[calc(50%-8px)]` instead of `top-1/2 -translate-y-1/2` to avoid conflict with horizontal `translate-x-*` (Tailwind v4 uses CSS `translate` shorthand — two translate classes on the same element override each other).

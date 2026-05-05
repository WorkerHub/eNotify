# enotify

[中文](./README.md) | English

A subscription management and expiry reminder system that helps you track subscriptions, expenses, and sends notifications through multiple channels.

## Features

- **Multi-user** — Registration/login, first user becomes admin automatically
- **Subscription Management** — Add, edit, renew, deactivate, with cycle/reset renewal modes
- **Payment History** — Record every payment, multi-currency with real-time exchange rates
- **Dashboard** — Monthly/yearly expense stats, expiry alerts, category analysis
- **9 Notification Channels** — Telegram, Webhook, WeChat Work, Email, Bark, Gotify, ServerChan, PushPlus, NotifyX
- **Scheduled Reminders** — Hourly auto-check with configurable notification hours
- **Two-Factor Auth** — TOTP (authenticator app), Email OTP, Passkey
- **Lunar Calendar** — Lunar date display and period calculation (1900-2100)
- **Theme Switching** — Light/Dark/System
- **Bilingual** — Chinese/English
- **Mobile-First** — Responsive design with bottom navigation

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

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (needs Workers and D1 permissions) |
| `D1_DATABASE_NAME` | D1 database name |
| `D1_DATABASE_ID` | D1 database ID |
| `KV_NAMESPACE_ID` | KV namespace ID |

### 3. Configure Worker Secrets

In the Cloudflare dashboard, go to Workers → enotify → Settings → Variables → Secrets, and add:

| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | JWT signing secret (random string) |
| `SETUP_SECRET` | Database initialization secret (random string) |

Or via CLI:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put SETUP_SECRET
```

### 4. Deploy

Push to `main` branch to trigger automatic deployment.

### 5. Initialize Database

After deployment, visit the following URL to initialize the database:

```
https://your-worker.workers.dev/api/setup/<SETUP_SECRET>
```

### 6. Register Admin

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

## Environment Variables

### Worker Environment Variables (Cloudflare Dashboard or wrangler.toml)

| Variable | Default | Description |
|----------|---------|-------------|
| `TABLE_PREFIX` | `""` | Database table prefix (e.g., `hk_`) |

### Worker Secrets (configured in Cloudflare dashboard)

| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | JWT signing secret |
| `SETUP_SECRET` | Database initialization route secret |

## License

MIT

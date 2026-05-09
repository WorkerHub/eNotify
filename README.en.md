# AppTemplate

A full-stack application template built on **React 19** + **Cloudflare Workers** (Hono.js), ready to use as a starting point for new projects.

## Features

- **Authentication** — Email/password login, registration (with on/off switch), logout, password reset
- **2FA** — TOTP (authenticator app), Passkey (WebAuthn biometrics), Email OTP
- **Admin Panel** — User management (roles, activate/deactivate, impersonate), system settings, email configuration, security settings
- **User Settings** — Language (zh/en), light/dark/system theme, timezone, session management
- **Sessions** — Multi-device session listing and revocation
- **i18n** — Chinese and English, auto-detected from browser
- **Theme** — Light / Dark / System via ThemeProvider
- **Database** — Cloudflare D1 (SQLite) with optional table prefix for shared DB isolation

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, shadcn/ui, React Router v7, react-i18next
- **Backend**: Cloudflare Workers, Hono.js, D1 (SQLite), KV
- **Auth**: JWT (access + refresh tokens, HttpOnly cookies), bcrypt, WebAuthn

## Quick Start

### 1. Clone and rename

```bash
git clone <this-repo> my-app
cd my-app
# Replace "app-template" and "AppTemplate" with your app name
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure Wrangler

Edit `worker/wrangler.toml`:
- Set your `account_id`
- Create a D1 database and set `database_id`
- Create a KV namespace and set its `id`
- Set `JWT_SECRET` (random 32+ char string)
- Set `SETUP_SECRET` (random string for DB init)
- Set `TABLE_PREFIX` (optional, e.g. `myapp_`, leave empty for no prefix)

### 4. Initialize the database

```bash
# Deploy first, then call setup:

# Option 1: GET (secret in URL, also works directly in the browser)
curl https://your-worker.workers.dev/api/setup/your-setup-secret

# Option 2: POST (secret in request header)
curl -X POST https://your-worker.workers.dev/api/setup \
  -H "X-Setup-Secret: your-setup-secret"
```

### 5. Start development

```bash
pnpm dev
```

## Adding Business Logic

### New API route (backend)

1. Create `worker/src/routes/myfeature.ts`
2. Import and register in `worker/src/index.ts`:
   ```ts
   import { myFeatureRoutes } from './routes/myfeature'
   app.route('/api/myfeature', myFeatureRoutes)
   ```

### New page (frontend)

1. Create `web/src/pages/myfeature/MyFeaturePage.tsx`
2. Add route in `web/src/App.tsx`
3. Add nav item in `web/src/components/layout/AppLayout.tsx`

### Extend the database schema

1. Add tables to `worker/src/db/schema.sql`
2. Add the same CREATE TABLE statements to `getSchema()` in `worker/src/routes/setup.ts`
3. Add query functions in `worker/src/db/queries/`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing JWTs (random 32+ char string) |
| `SETUP_SECRET` | Secret for calling the setup endpoint |
| `TABLE_PREFIX` | Optional prefix for all DB table names (e.g. `myapp_`) |

> For local development, configure these in `worker/wrangler.toml` `[vars]` section. For CI/CD deployment, they are injected via GitHub Secrets/Variables — no need to configure them in the Cloudflare console.

## Deployment

### Manual deploy

```bash
pnpm deploy
```

### CI/CD auto deployment

The project includes GitHub Actions workflows:

- **Deploy** — Auto-deploy to Cloudflare Workers on push to `main`
- **Release** — Auto-create GitHub Release on `v*` tag push
- **Tag** — Manually trigger a semantic version tag (e.g. `v1.0.0`)

Configure the following Secrets and Variables in your GitHub repository:

| Type | Name | Description | Required |
|------|------|-------------|----------|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Yes |
| Secret | `PAT_TOKEN` | Personal Access Token for creating tags | No¹ |
| Secret | `JWT_SECRET` | JWT signing secret | Yes |
| Secret | `SETUP_SECRET` | Database initialization secret | Yes |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Yes |
| Variable | `D1_DATABASE_NAME` | D1 database name | Yes |
| Variable | `D1_DATABASE_ID` | D1 database ID | Yes |
| Variable | `KV_NAMESPACE_ID` | KV namespace ID | Yes |
| Variable | `TABLE_PREFIX` | Database table name prefix | No² |

¹ `PAT_TOKEN` is only needed if you use the Tag workflow (manually create version tags to trigger Releases). Not required if you don't use this feature.
² `TABLE_PREFIX` allows multiple projects to share the same D1 database by adding a prefix to all table names, keeping each project's tables isolated (e.g. `app1_users`, `app2_users`). Leave empty for no prefix.

> All configuration is managed in the GitHub repository settings and automatically injected into `wrangler.toml` via sed during deployment — no manual configuration needed in the Cloudflare console.

## Project Structure

```
├── .github/
│   ├── workflows/          # GitHub Actions workflows
│   │   ├── deploy.yml      # Auto-deploy to Cloudflare Workers
│   │   ├── release.yml     # Auto-create GitHub Release
│   │   └── tag.yml         # Manual version tag trigger
│   └── renovate.json       # Renovate auto dependency update config
├── web/                    # Frontend project
│   ├── public/             # Static assets (logo.svg, favicon.svg, etc.)
│   ├── src/
│   │   ├── components/     # Shared components (ThemeProvider, UI components)
│   │   ├── hooks/          # Custom hooks (useAuth)
│   │   ├── layouts/        # Layout components
│   │   ├── locales/        # i18n resources (zh.json, en.json)
│   │   ├── pages/          # Pages
│   │   │   ├── admin/      # Admin panel pages
│   │   │   ├── auth/       # Auth pages (login, register, 2FA, etc.)
│   │   │   ├── home/       # Home page
│   │   │   ├── settings/   # User settings page
│   │   │   └── about/      # About page
│   │   ├── lib/            # Utilities (API, i18n, utils)
│   │   └── types/          # Type definitions
│   ├── vite.config.ts      # Vite build config
│   ├── tsconfig.json       # TypeScript config
│   └── package.json
├── worker/                 # Backend project
│   ├── src/
│   │   ├── routes/         # API routes (auth, admin, me, setup)
│   │   ├── core/           # Core logic (auth, time)
│   │   ├── middleware/      # Middleware (auth, admin, rate limit)
│   │   ├── db/
│   │   │   ├── queries/    # Database query functions
│   │   │   └── schema.sql  # Database schema
│   │   └── services/       # Services (email, 2FA)
│   ├── wrangler.toml       # Cloudflare Workers config
│   ├── tsconfig.json       # TypeScript config
│   └── package.json
├── README.md               # Project readme (Chinese)
├── README.en.md            # Project readme (English)
├── package.json            # Root monorepo config
├── pnpm-lock.yaml          # pnpm dependency lock file
├── pnpm-workspace.yaml     # pnpm workspace config
└── tsconfig.base.json      # TypeScript base config
```

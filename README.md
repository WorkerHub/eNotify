# AppTemplate

基于 **React 19** + **Cloudflare Workers** (Hono.js) 的全栈应用模板，可直接作为新项目的起始点。

## 功能特性

- **用户认证** — 邮箱/密码登录、注册（支持开关控制）、登出、密码重置
- **双因素认证 (2FA)** — TOTP（验证器应用）、Passkey（WebAuthn 生物识别）、邮箱 OTP
- **管理后台** — 用户管理（角色、启用/禁用、模拟登录）、系统设置、邮件配置、安全设置
- **用户设置** — 语言切换（中/英）、明暗主题切换、时区设置、会话管理
- **会话管理** — 多设备会话列表与会话撤销
- **国际化 (i18n)** — 中文和英文，自动检测浏览器语言
- **主题** — 亮色 / 暗色 / 跟随系统，通过 ThemeProvider 实现
- **数据库** — Cloudflare D1 (SQLite)，支持可选的表名前缀实现共享数据库隔离

## 技术栈

- **前端**: React 19, Vite, Tailwind CSS v4, shadcn/ui, React Router v7, react-i18next
- **后端**: Cloudflare Workers, Hono.js, D1 (SQLite), KV
- **认证**: JWT (access + refresh token, HttpOnly Cookie), bcrypt, WebAuthn

## 快速开始

### 1. 克隆并重命名

```bash
git clone <this-repo> my-app
cd my-app
# 将 "app-template" 和 "AppTemplate" 替换为你的应用名称
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置 Wrangler

编辑 `worker/wrangler.toml`：
- 设置你的 `account_id`
- 创建 D1 数据库并设置 `database_id`
- 创建 KV 命名空间并设置其 `id`
- 设置 `JWT_SECRET`（随机 32 位以上字符串）
- 设置 `SETUP_SECRET`（用于数据库初始化的随机字符串）
- 设置 `TABLE_PREFIX`（可选，表名前缀，如 `myapp_`，留空则不加前缀）

### 4. 初始化数据库

```bash
# 先部署，然后调用 setup 接口：

# 方式一：GET（secret 在 URL 中，也可直接在浏览器访问）
curl https://your-worker.workers.dev/api/setup/your-setup-secret

# 方式二：POST（secret 在请求头中）
curl -X POST https://your-worker.workers.dev/api/setup \
  -H "X-Setup-Secret: your-setup-secret"
```

### 5. 启动开发

```bash
pnpm dev
```

## 添加业务逻辑

### 新增 API 路由（后端）

1. 创建 `worker/src/routes/myfeature.ts`
2. 在 `worker/src/index.ts` 中导入并注册：
   ```ts
   import { myFeatureRoutes } from './routes/myfeature'
   app.route('/api/myfeature', myFeatureRoutes)
   ```

### 新增页面（前端）

1. 创建 `web/src/pages/myfeature/MyFeaturePage.tsx`
2. 在 `web/src/App.tsx` 中添加路由
3. 在 `web/src/components/layout/AppLayout.tsx` 中添加导航项

### 扩展数据库 Schema

1. 在 `worker/src/db/schema.sql` 中添加新表
2. 将相同的 CREATE TABLE 语句添加到 `worker/src/routes/setup.ts` 的 `getSchema()` 中
3. 在 `worker/src/db/queries/` 中添加查询函数

## 环境变量

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥（随机 32 位以上字符串） |
| `SETUP_SECRET` | 调用 setup 接口的密钥 |
| `TABLE_PREFIX` | 可选，所有数据库表名的前缀（如 `myapp_`） |

> 本地开发时直接在 `worker/wrangler.toml` 的 `[vars]` 中配置；CI/CD 部署时通过 GitHub Secrets/Variables 注入，无需在 Cloudflare 控制台额外配置。

## 部署

### 手动部署

```bash
pnpm deploy
```

### CI/CD 自动部署

项目包含 GitHub Actions 工作流：

- **Deploy** — 推送到 `main` 分支时自动部署到 Cloudflare Workers
- **Release** — 推送 `v*` 标签时自动创建 GitHub Release
- **Tag** — 手动触发创建语义化版本标签（如 `v1.0.0`）

需要在 GitHub 仓库中配置以下 Secrets 和 Variables：

| 类型 | 名称 | 说明 | 必须 |
|------|------|------|------|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API 令牌 | 是 |
| Secret | `PAT_TOKEN` | 用于创建标签的 Personal Access Token | 否¹ |
| Secret | `JWT_SECRET` | JWT 签名密钥 | 是 |
| Secret | `SETUP_SECRET` | 数据库初始化密钥 | 是 |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 是 |
| Variable | `D1_DATABASE_NAME` | D1 数据库名称 | 是 |
| Variable | `D1_DATABASE_ID` | D1 数据库 ID | 是 |
| Variable | `KV_NAMESPACE_ID` | KV 命名空间 ID | 是 |
| Variable | `TABLE_PREFIX` | 数据库表名前缀 | 否² |

¹ `PAT_TOKEN` 仅在使用 Tag 工作流（手动创建版本标签触发 Release）时需要，不使用该功能则无需配置。
² `TABLE_PREFIX` 通过添加表名前缀可以实现多个项目共用同一个 D1 数据库，不同项目的表互不干扰（如 `app1_users`、`app2_users`）。留空则不加前缀。

> 所有配置均在 GitHub 仓库中完成，部署时自动通过 sed 注入 `wrangler.toml`，无需在 Cloudflare 控制台手动配置变量。

## 项目结构

```
├── .github/
│   ├── workflows/          # GitHub Actions 工作流
│   │   ├── deploy.yml      # 自动部署到 Cloudflare Workers
│   │   ├── release.yml     # 自动创建 GitHub Release
│   │   └── tag.yml         # 手动触发版本标签
│   └── renovate.json       # Renovate 自动依赖更新配置
├── web/                    # 前端项目
│   ├── public/             # 静态资源 (logo.svg, favicon.svg 等)
│   ├── src/
│   │   ├── components/     # 通用组件 (ThemeProvider, UI 组件)
│   │   ├── hooks/          # 自定义 Hooks (useAuth)
│   │   ├── layouts/        # 布局组件
│   │   ├── locales/        # 国际化资源 (zh.json, en.json)
│   │   ├── pages/          # 页面
│   │   │   ├── admin/      # 管理后台页面
│   │   │   ├── auth/       # 认证页面 (登录、注册、2FA 等)
│   │   │   ├── home/       # 首页
│   │   │   ├── settings/   # 用户设置页
│   │   │   └── about/      # 关于页
│   │   ├── lib/            # 工具函数 (API、i18n、utils)
│   │   └── types/          # 类型定义
│   ├── vite.config.ts      # Vite 构建配置
│   ├── tsconfig.json       # TypeScript 配置
│   └── package.json
├── worker/                 # 后端项目
│   ├── src/
│   │   ├── routes/         # API 路由 (auth, admin, me, setup)
│   │   ├── core/           # 核心逻辑 (认证、时间)
│   │   ├── middleware/      # 中间件 (认证、管理员、限流)
│   │   ├── db/
│   │   │   ├── queries/    # 数据库查询函数
│   │   │   └── schema.sql  # 数据库 Schema
│   │   └── services/       # 服务层 (邮件、2FA)
│   ├── wrangler.toml       # Cloudflare Workers 配置
│   ├── tsconfig.json       # TypeScript 配置
│   └── package.json
├── README.md               # 项目说明 (中文)
├── README.en.md            # 项目说明 (英文)
├── package.json            # 根 monorepo 配置
├── pnpm-lock.yaml          # pnpm 依赖锁定文件
├── pnpm-workspace.yaml     # pnpm 工作区配置
└── tsconfig.base.json      # TypeScript 基础配置
```

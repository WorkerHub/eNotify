# eNotify

[English](./README.en.md) | 中文

智能通知管理系统，帮助您追踪各类到期事项/提醒事项与费用，并通过多种渠道发送提醒通知。

## 功能特性

- **多用户支持** — 注册/登录，首位用户自动成为管理员
- **通知管理** — 添加、编辑、续费、停用，支持周期/重置两种模式，区分普通提醒与订阅提醒
- **自动续费** — 过期订阅自动续期并记录支付历史
- **支付历史** — 记录每笔支付，支持多币种与实时汇率转换
- **仪表盘** — 月度/年度支出统计、到期预警、分类分析
- **9 个通知渠道** — Telegram、Webhook、企业微信、邮件、Bark、Gotify、Server酱、PushPlus、NotifyX
- **渠道管理** — 独立页面统一管理通知渠道的启用与配置
- **按项选择渠道** — 每个通知项可单独指定使用哪些渠道，未指定则默认使用所有已启用渠道
- **定时提醒** — 每小时自动检查并发送到期提醒，支持全局时段配置和每项独立覆盖
- **通知历史** — 查看所有已发送通知的记录与状态
- **两步验证** — TOTP（验证器应用）、邮箱验证码、Passkey
- **密码重置** — 通过邮箱验证码重置密码
- **管理员后台** — 用户管理、系统设置、模拟登录
- **农历支持** — 农历日期显示与周期计算（1900-2100）
- **主题切换** — 浅色/深色/跟随系统
- **双语** — 中文/英文切换
- **移动端适配** — 响应式设计，顶部栏 + 底部导航

## 技术栈

- **后端**: Cloudflare Workers + Hono.js (TypeScript)
- **数据库**: Cloudflare D1 (SQLite)
- **缓存**: Cloudflare KV
- **前端**: React 19 + Vite + Tailwind CSS v4 + shadcn/ui
- **部署**: GitHub Actions + Wrangler

## 部署指南

### 前置要求

- Cloudflare 账户
- GitHub 仓库
- Node.js >= 22
- pnpm

### 1. 创建 Cloudflare 资源

```bash
# 创建 D1 数据库
npx wrangler d1 create enotify-db

# 创建 KV 命名空间
npx wrangler kv namespace create ENOTIFY_KV
```

### 2. 配置 GitHub Secrets

在仓库的 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Workers 和 D1 权限） |
| `D1_DATABASE_NAME` | D1 数据库名称 |
| `D1_DATABASE_ID` | D1 数据库 ID |
| `KV_NAMESPACE_ID` | KV 命名空间 ID |

### 3. 配置 Worker Secrets

在 Cloudflare 控制台中，进入 Workers → enotify → Settings → Variables → Secrets，添加：

| Secret | 说明 |
|--------|------|
| `JWT_SECRET` | 任意 64 位随机字符串，例如 `openssl rand -hex 32` |
| `SETUP_SECRET` | 任意随机字符串，例如 `openssl rand -hex 16` |

也可以通过命令行配置：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put SETUP_SECRET
```

### 4. 部署

推送到 `main` 分支即可自动部署。

### 5. 初始化数据库

部署完成后，访问以下 URL 初始化数据库：

```
https://your-worker.workers.dev/api/setup/<SETUP_SECRET>
```

### 6. 注册管理员

访问应用首页注册账号，第一个注册的用户将自动成为管理员。

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发环境（前后端同时）
pnpm dev

# 仅启动前端
pnpm dev:web

# 仅启动后端
pnpm dev:worker
```

## 环境变量

### Worker 环境变量（Cloudflare Dashboard 或 wrangler.toml）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TABLE_PREFIX` | `""` | 数据库表前缀（如 `hk_`） |

### Worker Secrets（在 Cloudflare 控制台中配置）

| Secret | 说明 |
|--------|------|
| `JWT_SECRET` | JWT 签名密钥 |
| `SETUP_SECRET` | 数据库初始化路由密钥 |

## 许可证

[MIT](LICENSE)
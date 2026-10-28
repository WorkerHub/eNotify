# eNotify waker 迁移 · 冻结实现计划（读码核实 + 实现计划）

| 项 | 值 |
|---|---|
| 单据 | eNotify waker 迁移 · 读码核实 + 实现计划 |
| 形态 | 计划交付（**不改代码**：本单仓库改动只有本文件） |
| 定档 | 复杂 + 高安全，全流程（用户指定） |
| 上游规格 | 冻结规格 v1.1（用户 2026-10-28 拍板：「派 eNotify，也是改成极简模式，唯一要配置的是 WAKER_SIGNING_KEY，不配就走默认 cron。」） |
| 平台契约 | waker 冻结契约：回调协议 v2（B3）、注册 API（B4）、CF Cron 方言（B2）；`@workerhub/waker-client` 2.0.0 |
| 本文件用途 | 给 Chief 原样抄进后续实现单 spec 的**冻结结论**；按用户指示留在本单分支，**不合并进 main** |
| 与"过程文档不进仓库"的关系 | 规格 §4 要求过程文档只留单内；用户本次明确要求把本计划写成 `PLAN.md` 留在本单分支（不合并 main），本文件因此是**唯一例外**，且仅为交付物 |

---

## 0. 一页速览（冻结值总表）

| # | 冻结项 | 冻结值 |
|---|---|---|
| F1 | SDK 版本 | `@workerhub/waker-client` **2.0.0**，waker 仓库 commit **`2b1eb68`**（2026-10-27），7 个文件逐字拷贝到 `worker/src/waker/` |
| F1 | 接入 API | `createWakerReceiver({ jobs, signingKey, ledger, onJobError })`、`createD1ExecutionLedger(db, { table })`、`CALLBACK_MOUNT_PATH`；**不用** `mountWakerReceiver` / `createWakerClient*` / `resolveWakerMode` |
| F1 | 挂载点 | `app.route("/_waker", wakerRoutes())`，注册在 `app.get("*")`（SPA 兜底）**之前**；`POST /_waker/execute` 由 SDK receiver 处理 |
| F2 | 未配 key | 判定＝`trim()` 后空 / 纯空白 / `undefined` / `*_PLACEHOLDER` 结尾 ⇒ **未配置**；receiver 仍挂载，由 SDK fail closed：真回调 → **500 JSON** `signing_key_missing`，缺头 → 400，`GET` → 404；**不查库、不写账本、不执行业务**；未配 key 部署必须成功 |
| F3 | 迁移版本 | **`schema_v3`**（追加在 `worker/src/lib/migrations.ts` 末尾） |
| F3 | 账本表 | `{prefix}waker_executions`（8 列，逐字取 `executionLedgerDdl()`） |
| F3 | 认领表 | `{prefix}scheduler_tick_claims`（`tick_key PK, source, claimed_at`）+ `idx_{prefix}scheduler_tick_claims_claimed_at` |
| F3 | 前缀 | 只经 `getTablePrefix(env)`（`TABLE_PREFIX` 三态）；默认 → `enotify_waker_executions` / `enotify_scheduler_tick_claims` |
| F4 | secrets-file 注入 | 可选：`trim()` 非空才写入 secrets.json，空则跳过并只打状态；**永不打印值** |
| F4 | 停用路径 | `wrangler deploy --secrets-file` 是**增量**语义（省略不删旧值）⇒ 彻底停用需显式 `wrangler secret delete WAKER_SIGNING_KEY`（用户关口） |
| F4 | CI 互锁 | `wrangler.toml` 无 `[triggers]` 且 key 为空 ⇒ 部署步骤**失败**（防静默停摆） |
| F5 | 跨入口防重复 | D1 单语句原子认领：`INSERT … ON CONFLICT(tick_key) DO NOTHING` + `meta.changes`；`tick_key = "hour:<整点 epoch 毫秒>"`；两入口都先认领再 `await handleScheduled(env)` |
| F6 | 任务名 | **`hourly-reminder-sweep`**（waker 控制台手工建，与 receiver `jobs` key 逐字一致） |
| F6 | 策略 | `cron="0 * * * *"`、`timezone="UTC"`、`payload={}`、`misfire=fire_once`、`concurrency=forbid`、`maxRetries=2`、`backoffSeconds=30`、`timeoutSeconds=300`、`jitterSeconds=0`、`enabled=true` |
| F7 | 测试矩阵 | 3 个新测试文件 + 7 个既有测试文件的迁移名断言更新 + `test/support/sqlite-d1.ts` 补 `meta.changes`（见 §8） |
| — | 业务代码 | `worker/src/services/scheduler.ts` **零改动**（不拆 `processUser`，不改渠道/模板/窗口/历法/auto_renew） |

---

## 1. 读码核实（现状与证据）

### 1.1 现状事实

| 事实 | 证据位置 | 结论 |
|---|---|---|
| 原生调度入口 | `worker/src/index.ts:111` `async scheduled(_event, env, ctx) { ctx.waitUntil(handleScheduled(env)); }` | 改为 `await runSchedulerTick(env, { source: "cron", scheduledFor: event.scheduledTime })` |
| 业务逻辑单点 | `worker/src/services/scheduler.ts:19` `export async function handleScheduled(env)`；`processUser()` 整点批量语义 | **零改动**，两个入口共用这一份；不另写扫描/推送规则 |
| 定时配置 | `worker/wrangler.toml` `[triggers] crons = ["0 * * * *"]` | 阶段 1 原样保留（双跑）；删除属用户关口（阶段 2） |
| 密钥注入机制 | `.github/workflows/deploy.yml` "Write secrets file" → `wrangler deploy --secrets-file "$RUNNER_TEMP/secrets.json"`（`JWT_SECRET` / `SETUP_SECRET`） | 只在此机制上加**可选** `WAKER_SIGNING_KEY` |
| SPA 兜底 | `worker/src/index.ts` 末尾 `app.get("*")` → `ASSETS.fetch`，404 再回 `index.html` | 只匹配 GET/HEAD；`/_waker/*` 未处理时行为见 1.2 实测 |
| 迁移机制 | `worker/src/lib/migrations.ts`（有序列表、只追加 `schema_vN`、字面量不得含 `;`）+ `migrations-runner.ts`（账本表名只由 `migrationsTable()` 生成，`_enotify_schema_migrations`） | 新表走 `schema_v3`；当前最后一项是 `schema_v2` |
| 原子变更先例 | `worker/src/db/queries/notification-history.ts:110` `return result.meta.changes > 0;` | 认领语句沿用同一原语 |
| 前缀三态 | `worker/src/types.ts` `getTablePrefix()`：未配 → `enotify_`；自定义 → 补尾 `_`；显式 `""` → 无前缀；`DEFAULT_TABLE_PREFIX = "enotify"` | 新表全部经它解析，代码里不写死前缀 |
| 部署映射 | `deploy.yml` "Patch wrangler.toml"：vars 空 → `enotify`，`none` → `""`，其它原样 | 与本单无关，但证明 `TABLE_PREFIX` 是唯一变量名 |
| 当前无 waker 代码 | `grep -ri waker worker/ web/` 无命中 | 全新接入，无历史包袱 |
| 现有测试基线 | `pnpm --filter worker test` → 19 files / 247 tests 全绿 | 新改动不得破坏这 247 条 |

### 1.2 与规格不一致的 2 处（代码与事实优先）

**更正 ①：`POST /_waker/execute` 现状不会落 200 HTML。**

规格补充说"未显式处理会落 200 HTML 被 waker 误判成功"。实测（真实 `worker.fetch`，临时 vitest，跑完已删除）：

| 请求 | 现状结果 |
|---|---|
| `POST /_waker/execute` | **404 `text/plain` "404 Not Found"**（Hono 默认 404；`app.get("*")` 不匹配 POST） |
| `GET /_waker/execute` | **200 `text/html`**（走 `app.get("*")` → `ASSETS` → `index.html`） |
| `POST /unknown` | 404 `text/plain` |

结论："必须显式封住"的要求依然成立（平台投递是 POST，但 SPA 兜底对 GET 返回 200 HTML 是实打实的；且只要有人把兜底改成 `app.all` 或平台将来做探活就会命中），实现按 F2 显式挂载 receiver 封住 `/_waker/*`，并在测试里钉死"未配 key 时也是非 2xx JSON、绝不 200 HTML"。同时**不**把"现状会误判成功"写进实现单，避免照抄错误的验收断言。

**更正 ②：前缀变量名统一为 `TABLE_PREFIX`（用户核对）。**

`DB_TABLE_PREFIX` 是 nav 旧稿的短暂废弃名，eNotify 现行 `wrangler.toml` 占位符、`deploy.yml`、`getTablePrefix()` 全部用 `TABLE_PREFIX`。本计划全部按 `TABLE_PREFIX` 三态走，实现单不得引入 `DB_TABLE_PREFIX`。

### 1.3 waker 侧核实（只读另一个项目）

| 项 | 值 | 证据 |
|---|---|---|
| 平台仓库 | `WorkerHub/waker`，HEAD `2b1eb68`（2026-10-27 18:18 +0800） | `git log` |
| SDK 版本 | `client/package.json` `"version": "2.0.0"`，包名 `@workerhub/waker-client` | — |
| 接入方式（官方推荐） | "把 `client/src` 拷进下游项目（例如 `src/waker/`）"，唯一 peer 是 `hono` | `client/README.md` |
| 同队先例 | someday（ONE-566）已整目录拷贝同版本（README 记 `2.0.0` / commit `2b1eb68`），落 `worker/src/waker/`，业务接线在 `services/waker-callback.ts` + `routes/waker-callback.ts` | someday 仓库 |
| 协议常量 | `/_waker` + `/execute`；HMAC-SHA256 覆盖 `timestamp\nexecutionId\njobId\nrawBody`；时间窗 300s；`v2=` 前缀 hex | `client/src/protocol.ts` |
| 回调语义 | 2xx = 成功，非 2xx 一律失败进重试/死信；下游必须 await 业务 | `src/callback/client.ts`、`client/src/receiver.ts` |
| 账本语义 | `claim → 跑业务 → complete`；业务失败 `release`（重试才真重跑）；重复投递回 2xx + 首响应回放；占位 600s 可接管 | `client/src/ledger.ts` |
| 策略默认/上下界 | `maxRetries 0..100`、`backoffSeconds 0..86400`、`timeoutSeconds 1..86400`、`jitterSeconds 0..3600`；默认 `fire_once / forbid / 0 / 0 / 30 / 0` | `src/do/input.ts`、`src/do/types.ts` |
| 任务名约束 | 非空字符串，`≤ 200` 字符 | `MAX_NAME_LENGTH` |
| misfire 容差 | 槽位晚于 60s 即算错过，按策略折算补跑 | `src/do/policies.ts` |

---

## 2. F1 · waker SDK 准确版本 / 接入 API / receiver 挂载点

### 2.1 版本与拷贝

- 版本：`@workerhub/waker-client` **2.0.0**，来源 waker commit **`2b1eb68`**。
- 落地：`worker/src/waker/` 下**逐字拷贝** 7 个文件：

  ```
  protocol.ts  verify.ts  ledger.ts  receiver.ts  client.ts  modes.ts  index.ts
  ```

- 另加 `worker/src/waker/README.md`，内容与 someday 同款元信息：来源仓库、版本、commit、日期、"本目录不得手改；需要修 SDK 就回 waker 改、发版后整目录重拷并更新本表"、以及本仓只用到 receiver + D1 账本、业务接线位置。
- `biome.json` 必加排除 `"!**/worker/src/waker"`：逐字拷贝的 SDK 用单引号 / 无分号，实测会让 `pnpm format:check` 直接失败（7 errors）；加排除后 lint/format 与基线一致（1 warning / 1 info）。

### 2.2 用到的 API（其余一律不用）

| API | 用途 |
|---|---|
| `createWakerReceiver({ jobs, signingKey, ledger, onJobError })` | `/_waker/execute` 子应用：验签、时间窗、幂等、错误码、2xx 语义全由它决定 |
| `createD1ExecutionLedger(db, { table })` | executionId 幂等账本，落本仓 D1 |
| `executionLedgerDdl(table)` | **仅作建表 DDL 参照**（迁移里冻结成字面 SQL，不 import） |
| `CALLBACK_MOUNT_PATH` / `CALLBACK_PATH` | 挂载前缀与完整回调路径常量，避免手写字符串 |

**明确不用**（各有硬理由）：

| 不用 | 理由 |
|---|---|
| `mountWakerReceiver` | ① 被 `WAKER_MODE=waker` 门控，而 `WAKER_MODE` 是规格 §1 明确放弃项；② 缺 key 时**模块初始化就抛错**，与"未配 key 时部署必须成功"直接冲突 |
| `createWakerClient` / `createWakerClientFromEnv` / `syncManifest` / `createOneShot` / `cancelJob` | 规格 §1/§3：不配项目令牌、不实现注册 API 客户端、不动态注册/取消、不自续。文件随目录拷入但**永不调用**（README 里写明） |
| `resolveWakerMode` / `isWakerEnabled` | 同上，模式判定已废弃：本单的开关就是 `WAKER_SIGNING_KEY` 在不在 |

### 2.3 挂载点与请求路径

- `worker/src/index.ts`：

  ```ts
  app.route(CALLBACK_MOUNT_PATH, wakerRoutes());   // 必须注册在 app.get("*") 之前
  ```

- `worker/src/routes/waker.ts`：`wakerRoutes()` 把 `/_waker/*` 的每个请求转交给"按请求新建"的 Hono 宿主：

  ```ts
  const host = new Hono<HonoEnv>();
  host.route(CALLBACK_MOUNT_PATH, createWakerCallbackReceiver(env));
  return host.fetch(c.req.raw, c.env);
  ```

  为什么按请求构造：`env`（`WAKER_SIGNING_KEY`、`DB` 绑定）只在请求期可见，receiver 要按 env 取 signing key 与账本；构造只是建对象、不做 IO。someday 已验证同一写法（模块级单例 + 按请求转发）。
- 平台投递的完整路径：`https://<eNotify 域名>/_waker/execute`（项目回调地址填域名根，平台按 `resolveCallbackUrl` 自动拼 `/_waker/execute`）。
- 隔离性：`/_waker/*` 不走 `/api/*` 的 JWT fail-safe 中间件、不走 CORS（那两条只挂 `/api/*`），鉴权＝SDK 的 HMAC + 300s 时间窗；全局 `logger` 只记方法/路径/状态，不记 body 与签名（`redactSecrets` 也不受影响）。

### 2.4 依赖偏差（顺手消除）

- 现仓 `hono` 解析到 **4.13.13**；SDK 声明 peer `^4.13.14`。
- 实测：4.13.13 下 `worker typecheck` 通过、receiver 冒烟 4/4 通过，功能无阻塞。
- 冻结：实现单把 `worker/package.json` 的 `hono` 提到 `^4.13.14`（低风险，消除 peer 偏差；如需保守可另行评估，见 §13 Q1）。

---

## 3. F2 · 未配 key 的显式响应

### 3.1 判定（唯一单点）

```ts
// worker/src/services/scheduler-tick.ts（或 waker-callback.ts）唯一实现
export function readWakerSigningKey(env: Env): string | null {
  const raw = env.WAKER_SIGNING_KEY;
  if (typeof raw !== "string") return null;      // 缺失
  const key = raw.trim();
  if (key.length === 0) return null;             // 空 / 纯空白
  if (key.endsWith("_PLACEHOLDER")) return null; // 占位符防绕过（沿用 JWT_SECRET 约定）
  return key;
}
```

- **空值绝不被误判成"已配置"**：`""`、`"   "`、`undefined`、`*_PLACEHOLDER` 一律视为未配置。
- receiver **始终挂载**（这样 `/_waker/*` 永远不会回落到 SPA 兜底），未配 key 时由 SDK 自己 fail closed，不自研等价响应。

### 3.2 未配 key 时的实际响应（SDK 原生行为，实测见 §14）

| 请求 | 状态码 | 响应体 | 副作用 |
|---|---|---|---|
| 真实平台回调（带 4 个签名头） | **500** | `{"ok":false,"error":{"code":"signing_key_missing","message":"服务端未配置 WAKER_SIGNING_KEY，无法验签"}}` | 不查库、不写账本、不跑业务 |
| 带部分头 / 缺头 | **400** | `{"ok":false,"error":{"code":"invalid_request",…}}` | 同上 |
| `GET /_waker/execute` | **404** | Hono 默认 404（非 2xx） | 同上 |
| `GET/POST /_waker/other` | **404** | 非 2xx | 同上 |

- 全部**非 2xx JSON（或非 2xx 文本）**，绝不 200 HTML；平台侧按"非 2xx = 失败"重试/死信，可在控制台直接看到 `signing_key_missing`。
- **部署期不抛错**：模块初始化不读 key，未配 key 部署必然成功（这也是不用 `mountWakerReceiver` 的原因）。

### 3.3 落地约束

- `Env` 加 `WAKER_SIGNING_KEY?: string`，注释写明"只来自 GitHub Secrets → `deploy secrets-file`；缺失/空白 = 未配置 = 走默认 cron"。
- 该值只经 `readWakerSigningKey()` 读取一次，再以闭包形式传给 receiver（`signingKey: () => key`），保证"闸门"与"验签"用的是同一份判定结果。

---

## 4. F3 · executionId 账本 + 迁移版本 + 表名（冻结）

### 4.1 `schema_v3`（追加在 `worker/src/lib/migrations.ts` 列表末尾）

```sql
-- ① SDK executionId 幂等账本（8 列与 executionLedgerDdl() 逐列等价，冻结为字面 SQL：
--    迁移合并后不可再改，SDK 日后改 DDL 也不得动本历史项）
CREATE TABLE IF NOT EXISTS {prefix}waker_executions (
  execution_id   TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL,
  job_name       TEXT NOT NULL,
  scheduled_for  INTEGER NOT NULL,
  status         TEXT NOT NULL,
  response_json  TEXT,
  claimed_at     INTEGER NOT NULL,
  completed_at   INTEGER
);
-- ② 跨入口整点认领（本单防重复的核心）
CREATE TABLE IF NOT EXISTS {prefix}scheduler_tick_claims (
  tick_key    TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  claimed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_{prefix}scheduler_tick_claims_claimed_at
  ON {prefix}scheduler_tick_claims(claimed_at);
```

- 只增、幂等（`IF NOT EXISTS`）、无 `DROP`/`RENAME`/数据改写；**SQL 字符串字面量内不含 `;`**（runner 按 `;` 拆句）。
- `worker/src/db/schema.sql`（可读全量结构）同步补两张表，保持"结构与迁移结果一致"不漂移。
- 迁移执行 = 生产 schema 写 → **用户关口**：部署后在管理面点"检查并升级数据库"（或 `POST /api/admin/setup`），核对账本出现 `schema_v3`。

### 4.2 表名与前缀解析（冻结）

| 逻辑表 | 公式 | 默认前缀下实际名 | 无前缀（`TABLE_PREFIX=""`/CI `none`） |
|---|---|---|---|
| executionId 账本 | `wakerExecutionsTable(prefix)` = `` `${prefix}waker_executions` `` | `enotify_waker_executions` | `waker_executions` |
| 整点认领 | `schedulerTickClaimsTable(prefix)` = `` `${prefix}scheduler_tick_claims` `` | `enotify_scheduler_tick_claims` | `scheduler_tick_claims` |

- 前缀只经 `getTablePrefix(env)`（`TABLE_PREFIX` 三态），**不在代码里写死前缀**；表名只经上面两个 helper，别处禁止手拼。
- 迁移账本表名仍只由 `migrationsTable(prefix)` 生成（`_enotify_schema_migrations`），本单不改其规则。
- 自定义前缀（如 `eNotify`）→ `eNotify_waker_executions` / `eNotify_scheduler_tick_claims`，自动补尾 `_`。

### 4.3 数据访问层（新增文件）

`worker/src/db/queries/scheduler-ticks.ts`：

```ts
schedulerTickKey(scheduledFor: number): string           // "hour:" + 整点 epoch 毫秒
claimSchedulerTick(db, prefix, tickKey, source, now): Promise<boolean>
releaseSchedulerTick(db, prefix, tickKey, source): Promise<void>   // waker 失败时用
pruneSchedulerTicks(db, prefix, beforeEpochMs): Promise<void>      // 保留 7 天
```

- 认领语句（唯一的原子点）：

  ```sql
  INSERT INTO {prefix}scheduler_tick_claims (tick_key, source, claimed_at)
  VALUES (?, ?, ?)
  ON CONFLICT(tick_key) DO NOTHING
  ```

  返回 `meta.changes > 0` 即"赢得本次整点"。失败（含表不存在）由调用方按 §6.3 策略处理。
- `source` 取值只有 `"cron"` / `"waker"` 两个，仅用于观测与排障（哪一侧赢了整点）。

---

## 5. F4 · deploy secrets-file 的可选注入

### 5.1 注入写法（只动"Write secrets file"这一步）

```yaml
- name: Write secrets file
  working-directory: worker
  env:
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
    SETUP_SECRET: ${{ secrets.SETUP_SECRET }}
    WAKER_SIGNING_KEY: ${{ secrets.WAKER_SIGNING_KEY }}
  run: |
    node -e '
      const fs = require("fs");
      const secrets = { JWT_SECRET: process.env.JWT_SECRET, SETUP_SECRET: process.env.SETUP_SECRET };
      // …既有非空校验不变…
      // waker 回调验签密钥（本单唯一新增配置项，可选）：
      const wakerKey = (process.env.WAKER_SIGNING_KEY || "").trim();
      if (wakerKey.length > 0) {
        secrets.WAKER_SIGNING_KEY = wakerKey;
        console.log("WAKER_SIGNING_KEY: configured");
      } else {
        console.log("WAKER_SIGNING_KEY: not configured (native cron only)");
      }
      fs.writeFileSync(process.env.RUNNER_TEMP + "/secrets.json", JSON.stringify(secrets), { mode: 0o600 });
    '
```

- **只打印状态，绝不打印值**；密钥只经 GitHub Secrets → `$RUNNER_TEMP/secrets.json`（0600）→ `wrangler deploy --secrets-file`，不进仓库、不进 `[vars]`、不进日志、不进单据。
- `trim()` 后为空 ⇒ 不写入 ⇒ 不会把空值当成"已配置"。
- 未配 key 时部署**必须成功**：省略该键即可（脚本不 `exit 1`）。

### 5.2 wrangler 语义核实（决定了"停用路径"）

`wrangler@4.151.3` CLI 帮助文本（`--secrets-file`）：

> "Path to a file containing secrets to upload with the version (JSON or .env format). **Applies additively with secrets from previous deployments - omitted secrets will not be deleted.**"

因此：

| 目标 | 做法 | 结果 |
|---|---|---|
| 不配 key、走默认 cron | 省略该键（保持 `[triggers]` 在） | 原生 cron 不变；`/_waker/execute` 回 500 `signing_key_missing` |
| 启用 waker receiver | 在 GitHub Secrets 配 `WAKER_SIGNING_KEY` → 部署 | receiver 生效（双跑由 §6 认领仲裁） |
| **彻底停用** receiver（例如回滚后不想再收回调） | 省略键**不够**（旧 secret 还在）→ 执行 `npx wrangler secret delete WAKER_SIGNING_KEY` | 旧值删除，回调回 500 `signing_key_missing` |

停止接收回调用 `secret delete` 是运营动作（用户关口），写进 README 的正式说明；即使忘记删，整点认领也保证不会重复跑（见 §6）。

### 5.3 CI 互锁（新增，防"静默停摆"）

同一个 "Write secrets file" 步骤里加一条检查：

```
若 wrangler.toml 已无 [triggers]（grep -q '^\[triggers\]' 失败）且 wakerKey 为空
  → console.error("neither [triggers] nor WAKER_SIGNING_KEY is configured: nothing would run")
  → process.exit(1)
```

理由：`[triggers]` 一旦删除，调度来源只剩 waker；此时若有人清掉 GitHub Secret，整点将**没有任何入口**在跑，而线上只表现为"提醒静默消失"。这条互锁把这种配置错误挡在部署前（失败原因明确、不涉及任何密钥值）。

---

## 6. F5 · 跨入口防重复策略与证据

### 6.1 问题

`[triggers]` 保留期间，原生 Cron（`0 * * * *` UTC）与 waker 声明式任务（同表达式）会在同一整点各自触发一次，若都直接跑 `handleScheduled`，会造成：重复推送（KV 的 `notify_dedupe` 是 `get` → … → `put`，中间有 await，**不是原子的**，并发下两侧都可能通过）、重复自动续期写（`renew_dedupe` 同理）、重复清理与重复统计。规格要求：不能只说"已有去重所以没事"，必须给出可证明的跨入口方案。

### 6.2 方案：D1 单语句原子认领（每 UTC 整点一行）

```
tick_key = "hour:" + floor(名义时刻 / 3_600_000) * 3_600_000
cron  入口：名义时刻 = event.scheduledTime
waker 入口：名义时刻 = ctx.scheduledFor（平台名义槽位，不是 dispatchedAt）
```

- 统一入口 `runSchedulerTick(env, { source, scheduledFor })`：

  ```
  1) claim(tick_key, source)      // INSERT … ON CONFLICT(tick_key) DO NOTHING；meta.changes > 0 即赢
  2) await handleScheduled(env)   // 业务零改动（不拆 processUser、不碰渠道/模板/窗口/历法/auto_renew）
  3) prune(now - 7d)              // 清旧认领行，防表膨胀
  ```

- 为什么这一行就够：D1 是单点串行的 SQLite，`INSERT` 的单语句原子性由 SQLite 保证，`ON CONFLICT DO NOTHING` 让竞争双方只有一方得到 `changes = 1`；不引入"先查后写"的窗口。**这不是自研分布式锁**——它就是 SDK 账本自己在用的同一原语（`client/src/ledger.ts`），someday 已在线上用它做 executionId 幂等。
- 为什么不用现成替代：
  - KV：最终一致，没有"不存在才写入"，`get`+`put` 之间可被插入 ⇒ 不可用于互斥；
  - SDK 的 executionId 账本：键是平台执行 id，cron 侧根本没有这个 id，两入口无法共用同一行；
  - `concurrency: forbid`（平台侧）：只防 waker 自己重叠，防不住 cron。

### 6.3 失败语义（冻结，逐情形）

| 情形 | cron 入口 | waker 入口 |
|---|---|---|
| 认领语句报错（含表不存在），**key 未配**（此刻只有 cron 一个入口） | 记 `scheduler_tick_claim_unavailable` 后**照跑**（单入口不可能重复；也让"迁移未跑"不打断既有调度） | 不适用 |
| 认领语句报错，**key 已配**（可能存在双入口） | **不跑** + 报错日志（安全优先） | **抛错** → SDK 回 500 → 平台按策略重试/死信 |
| `changes = 0`（本整点已被认领） | 不跑（静默，debug 日志） | 2xx `{executed:false, reason:"duplicate_tick", claimedBy}`（平台记成功） |
| 业务抛错 | **保留**认领行：本小时不做二次全量扫描（避免对已处理用户重复发），只报错；下一整点自然恢复 | **删除**认领行后抛错 → 平台以同 `executionId` 重试 → 可重新认领并补完 |
| 业务正常 | 保留认领行（本小时封盘） | 保留认领行 |

非对称理由：cron 无重试、失败后立刻整轮重跑会重复发送已处理用户；waker 有平台重试且 `executionId` 账本保证"同一次执行的重试"语义，释放后重跑是**补齐**而不是"另起一次"。

### 6.4 证据计划（三层，逐层可复核）

1. **单测/集成（真实 SQLite，`node:sqlite`）**：同键两次认领恰好一次成功；`Promise.all` 并发两入口（同整点）→ `handleScheduled` 只被调用 1 次；不同整点各跑一次；整点归并边界（`09:59:59.999` 与 `10:00:00.000` 不同键）；waker 失败后同小时重试能重新认领；cron 失败保留认领行；认领报错 + key 无/有两种分支行为相反；7 天清理只删旧行。
2. **本地 receiver 端到端（真 HMAC 签名 + 真 SQLite）**：合法签名 → 200 且业务跑 1 次；同 `executionId` 重投 → 200 `duplicate:true` 不重跑；整点已被 cron 认领 → 200 `duplicate_tick` 不跑业务；未知任务名 → 404 `unknown_job`。（§14 已跑通前三条与认领原子性）
3. **生产分阶段观察（用户关口执行、只读核对）**：整点后

   ```sql
   SELECT tick_key, source, claimed_at FROM enotify_scheduler_tick_claims
    ORDER BY claimed_at DESC LIMIT 6;                       -- 每小时恰好 1 行
   SELECT substr(created_at,1,13) AS h, COUNT(*)
     FROM enotify_notification_history
    WHERE created_at > datetime('now','-6 hours') GROUP BY h;  -- 无翻倍
   ```

   外加 waker 控制台：执行记录 `succeeded`，响应体为 `duplicate_tick`（cron 先到）或 `executed`（waker 先到）。

### 6.5 判定

- 认领成立 + 阶段 1 观察整点无重复 ⇒ **生产双跑可开**（`[triggers]` 与 waker 任务并存）。
- "删除 `[triggers]` 转 waker 独占"属构建/部署配置 + 生产切换 ⇒ **报用户关口**，实现单不自行推进。

---

## 7. F6 · 那一个声明式 waker 任务（名称与策略冻结）

| 字段 | 冻结值 | 说明 / 依据 |
|---|---|---|
| 项目 | waker 控制台新建项目 `eNotify`，回调地址填 `https://<eNotify 生产域名>` | 平台按 `resolveCallbackUrl` 补 `/_waker/execute` |
| 任务名 | **`hourly-reminder-sweep`** | 必须与 receiver `jobs` 的 key 逐字一致（否则 404 `unknown_job`）；≤200 字符、非空 |
| kind | `cron` | 平台 `JobKind` |
| cron 表达式 | **`0 * * * *`**（逐字，5 字段，UTC 语义） | 与 `wrangler.toml` 的 `[triggers]` 完全一致；SDK 原样透传，不改写不解析 |
| timezone | **`UTC`** | 业务按用户时区自行换算通知小时，调度时区无关 |
| payload | `{}`（handler 完全忽略 payload） | 无 per-user tick 播种（规格 §1 放弃项） |
| policies.misfire | `fire_once` | alarm 延迟/停机后补一次；补跑仍用**名义槽位**做认领键，与 cron 天然去重 |
| policies.concurrency | `forbid` | 杜绝同一任务自身重叠（平台另有 in-flight 租约） |
| policies.maxRetries | `2` | 两次重试落在同一小时内；`executionId` 幂等保证重试不重复发 |
| policies.backoffSeconds | `30` | 30s / 60s 退避，与整点窗口匹配 |
| policies.timeoutSeconds | `300` | 远低于 CF scheduled 15 分钟预算；正常一轮为秒级。若线上观察一轮 > 5 分钟再单独调（策略改动只在控制台，不改代码） |
| policies.jitterSeconds | `0` | 单任务无惊群问题；0 抖动保证槽位确定、便于按整点核对 |
| enabled | `true` | — |

- **建任务由用户在 waker 控制台手工完成**（不写注册客户端、不放项目令牌、CI 不跑 `syncManifest`）：与本单"唯一配置是 `WAKER_SIGNING_KEY`"一致，任务名/策略以本表为准逐字填写。
- payload 不携带业务参数；handler 不返回 `nextRunAt`（声明式 cron，平台不使用）；不自续、不动态注册/取消。
- 平台建项目时**一次性展示**的 signing key → 直接存 GitHub Secrets `WAKER_SIGNING_KEY`（密码管理器留底一份），此后轮换在控制台做、旧 key 立即失效。

---

## 8. F7 · 测试矩阵

### 8.1 新增测试

| 文件 | 断言要点 |
|---|---|
| `worker/test/scheduler-tick.test.ts` | ① 同整点两次认领仅一次成功（真实 SQLite + `meta.changes`）；② `Promise.all` 并发 `cron`/`waker` 两入口 → `handleScheduled` 只跑 1 次、另一侧 `duplicate_tick`；③ 不同整点各跑一次；④ `schedulerTickKey` 整点归并与边界（`:59:59.999` vs `:00:00.000`）；⑤ waker 业务抛错 → 认领行被删、同小时重试可重跑；⑥ cron 业务抛错 → 认领行保留、不重跑；⑦ 认领报错 + key 未配 → 照跑；⑧ 认领报错 + key 已配 → cron 不跑 / waker 抛错；⑨ 7 天清理只删旧行；⑩ 三种 `TABLE_PREFIX` 态下落到正确表名 |
| `worker/test/waker-callback.test.ts` | ① 未配 key + 真回调 → **500 JSON `signing_key_missing`**，业务与 DB 零调用；② 缺签名头 → 400 `invalid_request`；③ `GET /_waker/execute` → 404（**绝不 200 HTML**）；④ 合法签名 → 200 且业务跑 1 次；⑤ 同 `executionId` 重投 → 200 `duplicate:true` 且业务不重跑；⑥ 时间戳超 300s → 401 `stale_timestamp`；⑦ 签名篡改 → 401 `invalid_signature`；⑧ 未知任务名 → 404 `unknown_job`；⑨ 整点已被 cron 认领 → 200 `{executed:false, reason:"duplicate_tick", claimedBy:"cron"}` 且业务不跑；⑩ 业务抛错 → 500 `job_failed`、executionId 占位释放 + 认领行释放、重试可重跑；⑪ 响应体不含密钥/payload 回显 |
| `worker/test/scheduled-entry.test.ts` | ① `scheduled()` 以 `event.scheduledTime` 走 `source:"cron"`；② 同一整点第二次调用不跑业务；③ 认领报错 + key 未配 → 仍跑；④ 认领报错 + key 已配 → 不跑；⑤ `scheduled()` 用 `await`（不是 `waitUntil`），业务完成即返回 |

### 8.2 既有测试改动

| 文件 | 改动 |
|---|---|
| `worker/test/support/sqlite-d1.ts` | `run()` 返回 `meta.changes`（取 `node:sqlite` 的 `changes`），否则认领断言无处可测；仅测试侧 |
| `worker/test/ledger.test.ts` | 迁移名断言补 `schema_v3`；新增 fresh install 两表存在、重复执行 skipped、三种前缀下表名正确 |
| `worker/test/migrations.test.ts` | 同上（`stamped` 后第二次 setup 追加 `v2+v3`） |
| `worker/test/prefix.test.ts` | 同上 + 新表三态表名 |
| `worker/test/setup.test.ts` / `admin.test.ts` / `ledger-failure.test.ts` / `notification-history.test.ts` | 迁移名断言同步补 `schema_v3`（实现时以 `grep -rn "schema_v2" worker/test` 为准，当前 7 个文件共 35 处） |

### 8.3 运行方式（CI 五件套 + 本单附加）

```bash
pnpm --filter worker test        # 目标：既有 247 + 新增 ≈ 30 条全绿
pnpm typecheck                   # worker + web
pnpm lint                        # biome lint .（SDK 目录已排除）
pnpm format:check                # biome format .（同上）
pnpm build                       # web + worker
```

---

## 9. 实现落点（文件清单，供实现单直接照抄）

| 文件 | 动作 | 关键内容 |
|---|---|---|
| `worker/src/waker/{protocol,verify,ledger,receiver,client,modes,index}.ts` + `README.md` | 新增 | SDK 逐字拷贝（waker@`2b1eb68`, v2.0.0）；README 写来源/版本/commit/"勿手改" |
| `worker/src/db/queries/scheduler-ticks.ts` | 新增 | `schedulerTickKey` / `claimSchedulerTick` / `releaseSchedulerTick` / `pruneSchedulerTicks` |
| `worker/src/services/scheduler-tick.ts` | 新增 | `runSchedulerTick(env, { source, scheduledFor })`、`readWakerSigningKey(env)`、`wakerExecutionsTable(prefix)`、`schedulerTickClaimsTable(prefix)` |
| `worker/src/services/waker-callback.ts` | 新增 | `WAKER_JOB_NAME = "hourly-reminder-sweep"`、`createWakerCallbackReceiver(env)`（jobs map + D1 账本 + `onJobError`） |
| `worker/src/routes/waker.ts` | 新增 | `wakerRoutes()`：按请求建宿主并 `host.route(CALLBACK_MOUNT_PATH, receiver)` |
| `worker/src/index.ts` | 改动 2 处 | `scheduled()` 改走 `runSchedulerTick(source:"cron")`；SPA 兜底前挂 `/_waker` |
| `worker/src/types.ts` | 改动 | `Env.WAKER_SIGNING_KEY?: string`（注释写明来源与"空=未配"） |
| `worker/src/lib/migrations.ts` | 改动 | 追加 `schema_v3`（两表 + 索引） |
| `worker/src/db/schema.sql` | 改动 | 补两张表 |
| `.github/workflows/deploy.yml` | 改动 | 可选注入 + `[triggers]`/key 互锁 |
| `biome.json` | 改动 | `"!**/worker/src/waker"` |
| `worker/package.json` | 改动 | `hono` → `^4.13.14` |
| `README.md` / `README.en.md` / `CLAUDE.md` | 改动 | 正式说明：唯一配置项、三种部署态、手工建任务（名字/表达式/策略）、轮换与停用步骤、`secret delete` 的说明 |
| `worker/test/*` | 新增/改动 | 见 §8 |

**不动**：`worker/src/services/scheduler.ts`（业务规则、渠道、模板、窗口、历法、`auto_renew`、`processUser` 全不动）、waker 平台本体、任何前端代码。

---

## 10. handler 契约（冻结）

- **任务名**：`hourly-reminder-sweep`。
- **handler 行为**：`await runSchedulerTick(env, { source: "waker", scheduledFor: ctx.scheduledFor })`，**同步等业务跑完**才返回（严禁 `waitUntil` + 立即 2xx）。
- **2xx 响应体**（`ok: true` 由 SDK 兜底添加；重复投递时 SDK 另加 `duplicate: true` 并回放首次响应）：

  ```jsonc
  // 本次真的跑了
  { "ok": true, "executed": true,  "reason": "executed",        "tickKey": "hour:1793112000000", "durationMs": 1234 }
  // 整点已被另一入口认领
  { "ok": true, "executed": false, "reason": "duplicate_tick",  "tickKey": "hour:1793112000000", "claimedBy": "cron", "durationMs": 3 }
  ```

  - 不自带 `duplicate` 字段（重投语义由 SDK 表达）；不返回 `nextRunAt`。
- **错误**：业务抛错 → 由 SDK 回 **500** `job_failed`（并释放 executionId 占位；本单实现同时释放认领行）。
- **日志**：`onJobError` 只记 `jobName` / `executionId` / `attempt` / error message；**不记** payload、签名头、密钥值；成功路径记一行 `waker tick: {executed, tickKey, durationMs}`。
- **忽略**：`ctx.payload`、`ctx.misfire`（补跑与正常跑业务语义相同，去重靠整点认领）、`ctx.attempt`（仅用于日志）。

---

## 11. 分阶段切换（每步都是用户关口）

| 阶段 | 动作 | 验证（只读） | 回滚 |
|---|---|---|---|
| **0 落地** | 合并实现单 → 自动部署（GitHub 无 `WAKER_SIGNING_KEY`） | 部署成功；`[triggers]` 仍在；下一整点 cron 照常；`POST /_waker/execute` 非 2xx JSON；管理面"检查并升级数据库"后账本出现 `schema_v3`、两表存在 | 回退代码（两表为空闲表，无破坏性变更）；`schema_v3` 可保留 |
| **1 双跑** | waker 控制台建项目 + `hourly-reminder-sweep`；signing key 存 GitHub Secrets → 部署 | 认领表每小时恰好 1 行；waker 执行记录 `succeeded`（响应 `duplicate_tick` 或 `executed`）；通知历史无翻倍；控制台 `manualTrigger` 一次作负向验证（应回 `duplicate_tick`、不重复发） | 清掉 GitHub Secret 重新部署（或保留 key，靠认领去重） |
| **2 独占** | 用户批准后删除 `wrangler.toml` 的 `[triggers]` → 部署 | 下一整点 waker 执行 `executed: true`；CF 侧无 cron | 恢复 `[triggers]` → 部署（回到双跑/纯 cron） |
| **停用** | 恢复 `[triggers]` 后 `npx wrangler secret delete WAKER_SIGNING_KEY` | 真回调回 500 `signing_key_missing`，业务不动 | 重配 secret 并部署 |

---

## 12. 风险与注意项

1. **"不配 key = 默认 cron"只在 `[triggers]` 存在时成立**：`[triggers]` 删除后，调度来源变成"平台任务 + 配置"双侧；这也是 §5.3 CI 互锁存在的原因。
2. **secrets-file 是增量语义**：省略 ≠ 删除（wrangler 帮助文本已核实）；停用必须显式 `secret delete`。
3. **`schema_v3` 未应用时**：认领表不存在 → key 未配则 cron 照跑（fail-open，此时只有一个入口），key 已配则两入口都停（安全优先）。所以阶段 1 的前置门槛是"迁移已完成"。
4. **迁移断言面较大**：`worker/test` 里 `schema_v2` 共 35 处（7 个文件），实现时用 `grep -rn schema_v2 worker/test` 逐一补齐，别漏。
5. **biome 排除是必须项**：逐字拷贝的 SDK 会让 `format:check` 失败（实测 7 errors）；排除后与基线一致。
6. **业务零改动**：`scheduler.ts` 一行不动；不拆 `processUser`；不碰渠道/模板/窗口/历法/`auto_renew`。
7. **key 轮换**：控制台轮换 → 旧 key 立即失效 → 窗口期回调 401 → 平台重试/死信；操作＝"轮换 + 更新 GitHub Secret + 重新部署"。
8. **日志卫生**：任何路径都不得打印 key、签名头或 payload；`onJobError` 与 CI 脚本都只打键名/状态。
9. **不合并 main**：本文件按用户指示只留本单分支，合并与否由用户/Chief 决定。

---

## 13. 开放问题（均无阻塞，已给默认值）

| # | 问题 | 默认取值（按此执行，用户要改只需改该一行） |
|---|---|---|
| Q1 | 实现单是否顺带把 `worker` 的 `hono` 提到 `^4.13.14`（SDK 声明 peer）？ | **提到 `^4.13.14`**（实测 4.13.13 也能跑，但消除 peer 偏差成本极低） |
| Q2 | §5.3 的 CI 互锁（无 `[triggers]` 且无 key → 部署失败）是否纳入实现单？ | **纳入**（4 行脚本，挡住最危险的静默停摆） |
| Q3 | 阶段 1 双跑观察窗口取多长？ | **至少 2 个整点，建议 24 小时**；观察项见 §6.4 第 3 层 |
| Q4 | waker 项目是否新建独立项目 `eNotify`，还是复用既有项目？ | **新建独立项目 `eNotify`**，回调地址填生产域名（key 一次性展示、单独轮换，互不影响） |
| Q5 | waker 任务是否长期与 `[triggers]` 双跑作为兜底？ | **不长期保留**：阶段 2 删 `[triggers]`（迁移目的就是统一调度源）；保留期间靠认领互斥 |
| Q6 | 是否需要为"登录/管理面展示 waker 回调状态"加 UI？ | **不做**（本单范围外，状态靠 Logs、认领表与 waker 控制台观察） |

---

## 14. 自测证据（本单实际执行过的命令与结果）

| # | 命令 / 操作 | 结果 |
|---|---|---|
| 1 | `pnpm --filter worker test` | **19 files / 247 tests 全绿**（改动前基线，证明后续断言改动有参照） |
| 2 | 临时 vitest（真实 `worker.fetch`，跑完已删除）实测现状 `/_waker/*` | `POST /_waker/execute` → **404 `text/plain`**；`GET /_waker/execute` → **200 `text/html`**（SPA）；`POST /unknown` → 404 ⇒ 更正规格"POST 落 200 HTML"的说法（见 §1.2） |
| 3 | 把 waker `client/src/*.ts` 逐字拷进 `worker/src/waker/` 后 `pnpm --filter worker typecheck` | **通过**（eNotify 现行 tsconfig，TS 7.0.2 / hono 4.13.13） |
| 4 | 临时 receiver 冒烟（真实 SQLite + 真 HMAC 签名，跑完已删除） | 无 key → `500 {"ok":false,"error":{"code":"signing_key_missing",…}}` 且业务零调用；合法签名首次 → `200 {"executed":true,"ok":true}`；同 `executionId` 重投 → `200 {…,"duplicate":true}` 且业务**只跑 1 次**；`ON CONFLICT DO NOTHING` + `meta.changes` 并发两次 → **恰好一次 `true`**；未知任务名 → `404 unknown_job` |
| 5 | `pnpm lint` / `pnpm format:check`（拷贝 SDK 后） | format **失败 7 errors**（逐字拷贝与仓内格式冲突） |
| 6 | 加 `"!**/worker/src/waker"` 排除后再跑 | `pnpm lint` → 1 warning / 1 info（与基线**一致**，非新增）；`pnpm format:check` → **0 error**；`pnpm --filter worker typecheck` → 通过 |
| 7 | `wrangler@4.151.3` CLI `--secrets-file` 帮助文本 | *"Applies additively with secrets from previous deployments - omitted secrets will not be deleted."* ⇒ 决定 §5.2 停用路径 |
| 8 | `git status --porcelain`（核实结束、清理临时文件后） | **空**——本单除本 `PLAN.md` 外未改动任何仓库文件 |

### 14.1 交付对照（角色要求：自测证据逐项对应）

| 交付项（规格 §4.1） | 冻结位置 | 对应证据 |
|---|---|---|
| SDK 准确版本 / 接入 API / receiver 挂载点 | §2 | 证据 3（typecheck 通过）、证据 4（receiver 冒烟 4/4） |
| 未配 key 的显式响应 | §3 | 证据 2（现状行为）、证据 4（500 JSON + 业务零调用） |
| executionId 账本表名 / 迁移版本 | §4 | 证据 1（既有迁移机制与基线）、§14 中 `schema_v2` 计数（35 处）由 `grep` 得出 |
| secrets-file 可选注入方式 | §5 | 证据 7（wrangler 增量语义） |
| 跨入口防重复策略与证据 | §6 | 证据 4（认领并发恰好一次成功）+ §6.4 三层证据计划 |
| waker 任务名与策略 | §7 | §1.3 平台契约（策略上下界、名字长度、misfire 语义） |
| 测试矩阵 | §8 | 证据 1（基线 247）+ §8.3 运行方式 |

---

## 15. 一页给实现单的抄写清单

1. 拷 SDK（waker@`2b1eb68`, v2.0.0）→ `worker/src/waker/`（7 文件 + README）+ `biome.json` 排除。
2. 加 `schema_v3`（`{prefix}waker_executions` + `{prefix}scheduler_tick_claims` + 索引）→ 同步 `schema.sql` → 更新 7 个测试文件的迁移名断言（35 处）。
3. 写 `scheduler-ticks.ts` + `scheduler-tick.ts`（认领/释放/清理/前缀 helper/`readWakerSigningKey`）。
4. 写 `waker-callback.ts`（`hourly-reminder-sweep` handler + D1 账本 + `onJobError`）+ `routes/waker.ts`（`/_waker` 挂载）→ `index.ts` 接线（`scheduled()` 走 `runSchedulerTick`，挂载先于 SPA 兜底）。
5. `deploy.yml`：可选注入 + 互锁；`README*`/`CLAUDE.md` 正式说明。
6. 按 §8 补齐测试，跑 CI 五件套，交付汇报里逐项贴命令与结果。
7. 阶段 0/1/2 按 §11 走，删除 `[triggers]`、执行迁移、`secret delete` 都是**用户关口**，实现单不自行推进。

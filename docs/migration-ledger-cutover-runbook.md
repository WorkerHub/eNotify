# 生产切换 runbook：迁移账本（schema_v1）+ 全站档重导入

> 适用：本仓库引入迁移账本（`worker/src/lib/migrations.ts` / `migrations-runner.ts` / `setup.ts` 状态机）之后的**生产库切换**。
> 执行者：仓库所有者本人。团队只提供本清单，不执行、不接触生产库。
> 本文按父单 ONE-400 规格 §8 的顺序写成可逐步执行清单，每步都有核对方法与回滚方法。

## 两条路径的关系（先读这一段）

- **合并即自动部署**（`main` 推送触发 deploy）。部署完成、用户执行下文切换之前，生产库处于「旧代码已下线、新代码待过渡」状态：新代码对存量库走的是**就地过渡分支**（旧补丁集最后跑一遍 → 验形 → 打戳 `schema_v1`），所以即使有人先点了「检查并升级数据库」，也只会安全打戳完成过渡，不会损坏数据。
- 本文的 §8 完整关口（导出 → 改名 → 新装 → 恢复导入 → 验收 → 重签 Key）是当初定下的**从严路径**：它给出的是一份「干净的新版全量结构（`schema_v1`–`schema_v4`）+ 官方恢复通道」的库，代价是需要重导入与重签 API Key。
- **二选一由用户在关口决定**：
  - 选「就地过渡」：部署后点一次「检查并升级数据库」，核对账本出现 `schema_v1`；再点一次把 `schema_v2`–`schema_v4` 补齐（建出 waker 表与 Vikunja 集成表）即可收工，不动数据、不重签 Key；
  - 选「§8 完整切换」：按下面 0–7 步执行。

  两条路径最终都是「同一套业务表（含 `schema_v4` 新建的 `vikunja_integrations`）+ `_enotify_schema_migrations` 账本含 `schema_v1` 起的全部迁移」，结构一致；区别只在于数据是怎么进新表的（就地 vs 导出再导入）。

---

## 0. 前置检查（不改动任何东西）

1. 确认已部署的版本包含本次改动：管理面板「检查并升级数据库」的返回里应带 `migrations` 字段（就地过渡会是 `[{"name":"schema_v1","status":"stamped"}]`，新装是 `schema_v1`–`schema_v4` 全部 `applied`，之后是 `skipped`）。
2. 记录切换前的基线数字（第 5 步要逐项对照）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command \
     "SELECT (SELECT COUNT(*) FROM enotify_users) AS users, (SELECT COUNT(*) FROM enotify_items) AS items, (SELECT COUNT(*) FROM enotify_notification_configs) AS configs, (SELECT COUNT(*) FROM enotify_payment_history) AS payments, (SELECT COUNT(*) FROM enotify_notification_history) AS history"
   ```

   **核对**：命令有返回、数字非空。**回滚**：无（只读）。

## 1. 全站档导出（切换前最后一份现行格式备份）

管理面板 → 备份页 → 全站档导出 → 下载 JSON 并妥善保存。

**核对**：文件能打开、`format`/`version` 字段存在、`users`／`items`／`notification_configs` 等条目数与第 0 步的数字对得上。
**回滚**：无（只读，不改库）。这份 JSON 是后续所有步骤的兜底。

## 2. 把业务表逐张 RENAME 到备份命名，并释放具名索引（不直删）

> ⚠️ **命名方式与规格 §2 的字面写法不同，原因写在这里**：`runSetup` 的前缀冲突守卫用 `detectTablePrefixes()` 识别「另一套 eNotify 表族」——只要库里存在 ≥4 张 `<前缀>_users` / `<前缀>_items` 这类命名的表且含 `users`，就会被判为另一个前缀并返回 409 `PREFIX_CONFLICT`。若把业务表改名成 `bak_users`、`bak_items` 这类**前缀形式**，第 3 步的新装会被守卫拦下。因此备份命名统一采用**后缀形式**：`enotify_<table>_bak_<YYYYMMDD>`，语义仍是「改名而不是删除」、随时可改回，但不会命中守卫的识别规则。

1. 先看账本表是否存在（部署后有人点过「检查并升级数据库」就会有）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command \
     "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_schema_migrations' ORDER BY name"
   ```

   如果出现 `_enotify_schema_migrations`，它描述的是马上要被改名的那批旧表，必须同时挪开，否则第 3 步会走「账本已存在」分支并因为业务表缺失而报 `LEDGER_INCONSISTENT`（这是刻意的安全闸，不是 bug）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command \
     "ALTER TABLE _enotify_schema_migrations RENAME TO _enotify_schema_migrations_bak_<YYYYMMDD>"
   ```

2. 逐张改名（7 张核心业务表 + 部署后可能已建的 `vikunja_integrations`，`<YYYYMMDD>` 由执行时确定并记入交付评论）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_users RENAME TO enotify_users_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_user_2fa RENAME TO enotify_user_2fa_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_items RENAME TO enotify_items_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_payment_history RENAME TO enotify_payment_history_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_notification_configs RENAME TO enotify_notification_configs_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_system_settings RENAME TO enotify_system_settings_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_notification_history RENAME TO enotify_notification_history_bak_<YYYYMMDD>"
   ```

   这 7 张表各自带具名二级索引，`RENAME TO` 会把索引连同**原名字**一起留在备份表上。第 3 步新装的 `CREATE INDEX IF NOT EXISTS` 见到名字已存在会静默跳过，活表就会永久缺少这些索引（`items.user_id`、`payment_history.item_id/user_id`、`notification_history.user_id/filter` 的查询都会退化为全表扫描）。所以改名后要立刻释放这 5 个规范索引名（备份表不再保留这些二级索引，行数据本身完整）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_items_user_id"
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_payment_history_item_id"
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_payment_history_user_id"
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_notification_history_user_id"
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_notification_history_filter"
   ```

   另有一张表必须单独确认：`enotify_vikunja_integrations`（本版 `schema_v4` 新建，带指向 `enotify_users` 的外键）。部署后点过「检查并升级数据库」的库才会有它；存在时必须一起改名（并按下面三条命令处理索引），否则第 3 步会因为「表已存在」跳过建表，而它的外键已经被 `RENAME TO` 改写指向备份用户表，之后新建用户的集成记录会报 `FOREIGN KEY constraint failed`。先查它是否存在：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command \
     "SELECT name FROM sqlite_master WHERE type='table' AND name='enotify_vikunja_integrations'"
   ```

   有返回就按顺序执行下面三条（无返回则全部跳过，第 3 步会新建）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_vikunja_integrations RENAME TO enotify_vikunja_integrations_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_vikunja_integrations_hook_token"
   npx wrangler d1 execute <D1_NAME> --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_enotify_vikunja_integrations_bak_hook_token ON enotify_vikunja_integrations_bak_<YYYYMMDD>(hook_token)"
   ```

   **为什么不能只改名**：SQLite 的 `ALTER TABLE ... RENAME TO` 会把带显式名字的索引跟着表保留在原名字下，`idx_enotify_vikunja_integrations_hook_token` 会留在备份表上；第 3 步新装的 `CREATE UNIQUE INDEX IF NOT EXISTS` 见到名字已存在会**静默跳过**，活表就没有 `hook_token` 唯一约束（重复 token 能插入，入站按 token 查用户会变成不确定）。因此必须先释放规范索引名，再给备份快照另建一个改名后的唯一索引；三条命令的顺序不能调换。

   该表由 `schema_v4` 新建，切换前没有需要迁移的历史数据（全站档导出也不含它）；如果你在切换前已经建过集成，切换完成后重新创建一次即可（新 secret 只显示一次）。

   注意：SQLite 的 `RENAME TO` 会把其他表里指向它的外键定义一并改写到新名字，所以备份表族内部仍然自洽（改回时同样自动还原）。

**核对**：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

应看到 7 张核心业务表的 `enotify_*_bak_<YYYYMMDD>`（若第 2 步检测到集成表，还会多一张 `enotify_vikunja_integrations_bak_<YYYYMMDD>`），且**没有**任何以 `users`/`user_2fa`/`items`/`payment_history`/`notification_configs`/`system_settings`/`notification_history`/`vikunja_integrations` 结尾或等值的表名（这是第 3 步能顺利新装的关键）。7 张核心业务表的备份表只保留表与行数据：它们的具名二级索引已在第 2 步被释放、不再复制；集成表的备份表则保留一个改名后的唯一索引 `idx_enotify_vikunja_integrations_bak_hook_token`。这样第 3 步才能把规范索引建到活表上，不是数据损坏。

**回滚**：把这批改名改回去（`ALTER TABLE enotify_users_bak_<YYYYMMDD> RENAME TO enotify_users`，其余同理；若曾改过集成表，同样改回 `enotify_vikunja_integrations`）。第 2 步已把规范索引名从备份表上释放，所以改回后必须把 5 个核心二级索引和集成表的唯一索引重新建回：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_items_user_id ON enotify_items(user_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_payment_history_item_id ON enotify_payment_history(item_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_payment_history_user_id ON enotify_payment_history(user_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_notification_history_user_id ON enotify_notification_history(user_id, created_at)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_notification_history_filter ON enotify_notification_history(user_id, channel, success, created_at)"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_vikunja_integrations_bak_hook_token"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_enotify_vikunja_integrations_hook_token ON enotify_vikunja_integrations(hook_token)"
```

（最后两条只适用于第 2 步检测到集成表、执行过那三条命令的库；切换前没有该表时跳过这两条，否则会报 `no such table: main.enotify_vikunja_integrations`。）

最后把第 1 小步挪开的账本表改回原名；然后重跑一次 setup 让它按当前真实结构决定打戳或跳过。

## 3. 触发 setup，走新装路径生成全量结构（schema_v1–schema_v4）+ 账本

管理面板「检查并升级数据库」，或：

```bash
curl -X POST https://<你的域名>/api/setup -H "X-Setup-Secret: <SETUP_SECRET>"
```

**核对**：返回 `{"success":true,"effectivePrefix":"enotify_","migrations":[{"name":"schema_v1","status":"applied"},{"name":"schema_v2","status":"applied"},{"name":"schema_v3","status":"applied"},{"name":"schema_v4","status":"applied"}]}`（此路径**不应**出现 `alreadyInitialized`）；

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "SELECT name FROM _enotify_schema_migrations"
```

应有 `schema_v1`、`schema_v2`、`schema_v3`、`schema_v4` 四行。同一条查询里的 `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'enotify_%'` 会同时列出第 2 步改名留下的 `enotify_*_bak_<YYYYMMDD>`；排除这些备份表后应正好是 10 张：7 张核心业务表 + `waker_executions` + `scheduler_tick_claims` + `vikunja_integrations`。

再确认活表带回了全部具名索引。5 个核心二级索引：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name IN ('idx_enotify_items_user_id','idx_enotify_payment_history_item_id','idx_enotify_payment_history_user_id','idx_enotify_notification_history_user_id','idx_enotify_notification_history_filter')"
```

应返回 5 行，且 `tbl_name` 分别是 `enotify_items`、`enotify_payment_history`（两条）、`enotify_notification_history`（两条），不能是 `*_bak_<YYYYMMDD>`。

集成表的唯一索引（`sqlite_master` 看不出唯一性，用 `PRAGMA index_list`）：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "PRAGMA index_list(enotify_vikunja_integrations)"
```

结果里必须有 `name = idx_enotify_vikunja_integrations_hook_token` 且 `unique = 1` 的一行。

**如果索引缺失**（例如第 2 步漏做了释放）：重跑 setup 不会补救——`schema_v1`–`schema_v4` 已记入账本，返回全是 `skipped`，DDL 不会再执行。请在**活表**上直接重建；SQLite 的索引名是全库唯一的，若规范名仍被备份表占用，必须先释放，建完再把备份表的索引补回：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_vikunja_integrations_hook_token"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_enotify_vikunja_integrations_hook_token ON enotify_vikunja_integrations(hook_token)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_enotify_vikunja_integrations_bak_hook_token ON enotify_vikunja_integrations_bak_<YYYYMMDD>(hook_token)"
```

5 个核心索引同理，必须**先释放名字、再建**。`CREATE INDEX IF NOT EXISTS` 的名字检查是全库的：规范名此刻还挂在备份表上，直接建会被静默跳过；带 `IF NOT EXISTS` 时不会报错，去掉它时 SQLite 的报错原文是 `index <名字> already exists`（不是「already an index with that name」）。按下面的顺序执行：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_items_user_id"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_payment_history_item_id"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_payment_history_user_id"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_notification_history_user_id"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP INDEX IF EXISTS idx_enotify_notification_history_filter"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_items_user_id ON enotify_items(user_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_payment_history_item_id ON enotify_payment_history(item_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_payment_history_user_id ON enotify_payment_history(user_id)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_notification_history_user_id ON enotify_notification_history(user_id, created_at)"
npx wrangler d1 execute <D1_NAME> --remote --command "CREATE INDEX IF NOT EXISTS idx_enotify_notification_history_filter ON enotify_notification_history(user_id, channel, success, created_at)"
```

若在索引缺失期间已经写入重复的 `hook_token`，先清掉重复行（`SELECT hook_token, COUNT(*) AS n FROM enotify_vikunja_integrations GROUP BY hook_token HAVING n > 1`，保留一行再删其余）再建唯一索引，否则建索引会失败。

**回滚**：按下面的顺序删除第 3 步新建的表（先子表、后父表，每一张都要删，否则改回备份时会重名）：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_vikunja_integrations"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_user_2fa"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_notification_configs"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_payment_history"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_items"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_notification_history"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_system_settings"
npx wrangler d1 execute <D1_NAME> --remote --command "DROP TABLE enotify_users"
```

`enotify_waker_*` 不参与本流程：切换前已有的保留原样；切换前没有的（第 3 步新建）一并 `DROP TABLE enotify_waker_executions` 与 `DROP TABLE enotify_scheduler_tick_claims`。把 `_enotify_schema_migrations` 改名为 `_enotify_schema_migrations_discard_<YYYYMMDD>`，再把第 2 步的备份表族改回原名（含集成表），并按第 2 步回滚的全部索引语句把 5 个核心二级索引和集成表的规范唯一索引建回。库即回到切换前状态（数据仍在备份表里）。

## 4. 用全站档「恢复模式」导入第 1 步的 JSON

管理面板 → 备份页 → 导入 → 选择**恢复模式**（只进空实例，此刻正是空实例）。

**核对**：导入返回的计数与第 0 步基线一致；`SELECT COUNT(*) FROM enotify_users` 等数字与基线逐项相同。

**回滚**：重复第 3 步的「回滚」操作即可（清掉新表后把备份表族改回原名）；导入进来的数据随之丢弃。

## 5. 验收（全部通过才继续）

1. 用户数／事项数／渠道配置数与第 0 步基线逐项相同（含 `payment_history`、`notification_history`）。
2. 用管理员账号登录成功；开启过 TOTP / Passkey 的账号可继续用原 secret/凭据登录（secret 原样在导出内）。
3. 通知设置页「默认渠道」可保存；用一条测试直推验证只走默认渠道。
4. 账本核对：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command \
     "SELECT name, applied_at FROM _enotify_schema_migrations"
   ```

   应有且仅有 `schema_v1`、`schema_v2`、`schema_v3`、`schema_v4` 四行。
5. 再次点「检查并升级数据库」应返回四条 `skipped`（`schema_v1`–`schema_v4`，幂等、无副作用）。

**任一项不过**：立即执行第 3 步的回滚，把备份表族改回原名，回到切换前状态，并把失败项记入交付评论。

## 6. 重签 API Key

导出不含 API Key（KV 里只存哈希），切换后按规格统一重签：逐个使用者新建 Key（新建后经安全卡片交付），再在「API Key」页面吊销旧记录。包括 Muse 的 `custom.enotify` 连接器所用的那把——重签后 Muse 负责重连并实测。

**核对**：新 Key 调用 `GET /api/items` 返回 200；旧 Key 调用返回 401。
**回滚**：KV 未参与本次 D1 切换，旧 Key 记录仍在 KV 中，未吊销前仍可用——因此这一步的回滚就是「暂缓吊销、保留旧 Key」；重签本身不需要回滚。

## 7. 备份表族的去留

`enotify_*_bak_<YYYYMMDD>` 与 `_enotify_schema_migrations_bak_<YYYYMMDD>` 在验收通过后**保留不删**，去留由用户另行决定（删掉即失去手动回退能力；如需删除，先用 `SELECT COUNT(*)` 确认新表数据完整）。其中 `enotify_vikunja_integrations_bak_<YYYYMMDD>`（仅当第 2 步检测到该表时存在）只是切换前的集成配置快照，新库的集成表已由 `schema_v4` 建出、旧 secret 不会被复用。注意它仍挂着指向 `enotify_users_bak_<YYYYMMDD>` 的 `ON DELETE CASCADE` 外键：一旦删除 bak 用户表，快照行会被级联清空（表还在、数据没了），所以它本就不承载需要保留的数据；需要集成时在设置页重新创建一次即可。

---

## 附：就地过渡路径（与上面的二选一）

部署后不执行第 1–7 步，只点一次「检查并升级数据库」：

- 返回 `migrations:[{"name":"schema_v1","status":"stamped"}]`；
- 旧补丁集最后跑一遍（补齐历史增量、清理退役渠道 ID），验形通过后写入账本一条 `schema_v1`；
- 数据原地不动，无需重签 API Key；
- 打戳只记录 `schema_v1`；再点一次会把 `schema_v2`–`schema_v4` 补上（建出 waker 表与 Vikunja 集成表），返回里是它们的 `applied`，之后再点返回全部 `skipped`。

若验形失败，setup 返回 `SCHEMA_VERIFY_FAILED` 并列出缺失的表/列，**账本不会被打戳**；按错误提示修复后重试即可，旧补丁产生的增量都是幂等的、无害的。

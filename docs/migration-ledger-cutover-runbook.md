# 生产切换 runbook：迁移账本（schema_v1）+ 全站档重导入

> 适用：本仓库引入迁移账本（`worker/src/lib/migrations.ts` / `migrations-runner.ts` / `setup.ts` 状态机）之后的**生产库切换**。
> 执行者：仓库所有者本人。团队只提供本清单，不执行、不接触生产库。
> 本文按父单 ONE-400 规格 §8 的顺序写成可逐步执行清单，每步都有核对方法与回滚方法。

## 两条路径的关系（先读这一段）

- **合并即自动部署**（`main` 推送触发 deploy）。部署完成、用户执行下文切换之前，生产库处于「旧代码已下线、新代码待过渡」状态：新代码对存量库走的是**就地过渡分支**（旧补丁集最后跑一遍 → 验形 → 打戳 `schema_v1`），所以即使有人先点了「检查并升级数据库」，也只会安全打戳完成过渡，不会损坏数据。
- 本文的 §8 完整关口（导出 → 改名 → 新装 → 恢复导入 → 验收 → 重签 Key）是当初定下的**从严路径**：它给出的是一份「干净的新 schema_v1 结构 + 官方恢复通道」的库，代价是需要重导入与重签 API Key。
- **二选一由用户在关口决定**：
  - 选「就地过渡」：部署后点一次「检查并升级数据库」，核对账本出现 `schema_v1` 即可收工，不动数据、不重签 Key；
  - 选「§8 完整切换」：按下面 0–7 步执行。

  两条路径最终都是「7 张业务表 + `_enotify_schema_migrations` 账本含一条 `schema_v1`」，结构一致；区别只在于数据是怎么进新表的（就地 vs 导出再导入）。

---

## 0. 前置检查（不改动任何东西）

1. 确认已部署的版本包含本次改动：管理面板「检查并升级数据库」的返回里应带 `migrations` 字段（就地过渡会是 `[{"name":"schema_v1","status":"stamped"}]`，新装是 `applied`，之后是 `skipped`）。
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

## 2. 把 7 张业务表逐张 RENAME 到备份命名（不直删）

> ⚠️ **命名方式与规格 §2 的字面写法不同，原因写在这里**：`runSetup` 的前缀冲突守卫用 `detectTablePrefixes()` 识别「另一套 eNotify 表族」——只要库里存在 ≥4 张 `<前缀>_users` / `<前缀>_items` 这类命名的表且含 `users`，就会被判为另一个前缀并返回 409 `PREFIX_CONFLICT`。若把 7 张表改名成 `bak_users`、`bak_items` 这类**前缀形式**，第 3 步的新装会被守卫拦下。因此备份命名统一采用**后缀形式**：`enotify_<table>_bak_<YYYYMMDD>`，语义仍是「改名而不是删除」、随时可改回，但不会命中守卫的识别规则。

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

2. 逐张改名（7 条，`<YYYYMMDD>` 由执行时确定并记入交付评论）：

   ```bash
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_users RENAME TO enotify_users_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_user_2fa RENAME TO enotify_user_2fa_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_items RENAME TO enotify_items_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_payment_history RENAME TO enotify_payment_history_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_notification_configs RENAME TO enotify_notification_configs_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_system_settings RENAME TO enotify_system_settings_bak_<YYYYMMDD>"
   npx wrangler d1 execute <D1_NAME> --remote --command "ALTER TABLE enotify_notification_history RENAME TO enotify_notification_history_bak_<YYYYMMDD>"
   ```

   注意：SQLite 的 `RENAME TO` 会把其他表里指向它的外键定义一并改写到新名字，所以备份表族内部仍然自洽（改回时同样自动还原）。

**核对**：

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

应看到 7 张 `enotify_*_bak_<YYYYMMDD>`，且**没有**任何以 `users`/`user_2fa`/`items`/`payment_history`/`notification_configs`/`system_settings`/`notification_history` 结尾或等值的表名（这是第 3 步能顺利新装的关键）。

**回滚**：把这 7 条改回去（`ALTER TABLE enotify_users_bak_<YYYYMMDD> RENAME TO enotify_users`，其余同理），并把第 1 小步挪开的账本表改回原名；然后重跑一次 setup 让它按当前真实结构决定打戳或跳过。

## 3. 触发 setup，走新装路径生成 schema_v1 全量结构 + 账本

管理面板「检查并升级数据库」，或：

```bash
curl -X POST https://<你的域名>/api/setup -H "X-Setup-Secret: <SETUP_SECRET>"
```

**核对**：返回 `{"success":true,"effectivePrefix":"enotify_","migrations":[{"name":"schema_v1","status":"applied"}]}`（此路径**不应**出现 `alreadyInitialized`）；

```bash
npx wrangler d1 execute <D1_NAME> --remote --command \
  "SELECT name FROM _enotify_schema_migrations"
```

应只有一行 `schema_v1`；`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'enotify_%'` 应是 7 张业务表。

**回滚**：把这一步新生成的 7 张空表改名或删除（`DROP TABLE enotify_users` …），把 `_enotify_schema_migrations` 改名为 `_enotify_schema_migrations_discard_<YYYYMMDD>`，再把第 2 步的备份表族改回原名。库即回到切换前状态（数据仍在备份表里）。

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

   应有且仅有 `schema_v1`。
5. 再次点「检查并升级数据库」应返回 `migrations:[{"name":"schema_v1","status":"skipped"}]`（幂等、无副作用）。

**任一项不过**：立即执行第 3 步的回滚，把备份表族改回原名，回到切换前状态，并把失败项记入交付评论。

## 6. 重签 API Key

导出不含 API Key（KV 里只存哈希），切换后按规格统一重签：逐个使用者新建 Key（新建后经安全卡片交付），再在「API Key」页面吊销旧记录。包括 Muse 的 `custom.enotify` 连接器所用的那把——重签后 Muse 负责重连并实测。

**核对**：新 Key 调用 `GET /api/items` 返回 200；旧 Key 调用返回 401。
**回滚**：KV 未参与本次 D1 切换，旧 Key 记录仍在 KV 中，未吊销前仍可用——因此这一步的回滚就是「暂缓吊销、保留旧 Key」；重签本身不需要回滚。

## 7. 备份表族的去留

`enotify_*_bak_<YYYYMMDD>` 与 `_enotify_schema_migrations_bak_<YYYYMMDD>` 在验收通过后**保留不删**，去留由用户另行决定（删掉即失去手动回退能力；如需删除，先用 `SELECT COUNT(*)` 确认新表数据完整）。

---

## 附：就地过渡路径（与上面的二选一）

部署后不执行第 1–7 步，只点一次「检查并升级数据库」：

- 返回 `migrations:[{"name":"schema_v1","status":"stamped"}]`；
- 旧补丁集最后跑一遍（补齐历史增量、清理退役渠道 ID），验形通过后写入账本一条 `schema_v1`；
- 数据原地不动，无需重签 API Key；
- 之后每次升级再点一次，返回 `skipped` 或新迁移的 `applied`。

若验形失败，setup 返回 `SCHEMA_VERIFY_FAILED` 并列出缺失的表/列，**账本不会被打戳**；按错误提示修复后重试即可，旧补丁产生的增量都是幂等的、无害的。

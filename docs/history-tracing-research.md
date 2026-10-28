# 通知历史溯源优化调研报告

> 调研日期：2026-10-28  
> 范围：eNotify 通知历史页的溯源、渠道/状态筛选、失败原因详情的数据模型与实现方案

---

## 一、现状盘点

### 1.1 数据库层

**`notification_history` 表**（`worker/src/lib/migrations.ts`，`schema_v1` 第 124–134 行）：

```sql
CREATE TABLE IF NOT EXISTS {prefix}notification_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  item_id    TEXT,               -- 可为 NULL，但缺少触发来源类型标识
  channel    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  success    INTEGER NOT NULL DEFAULT 1,
  error      TEXT,
  created_at TEXT NOT NULL
);
```

- `item_id` 字段存在，但为可空 TEXT，无法区分"事项到期触发"与"API 调用触发"与"渠道测试触发"——三种情况下 `item_id` 都可能为 NULL。
- 缺少 `trigger_source` 枚举字段，无法从记录本身判断来源。
- 索引只有 `(user_id, created_at)`，缺少按 `channel` 或 `success` 的筛选索引。

### 1.2 写入层

触发来源与历史写入现状如下：

| 触发路径 | 入口 | 写历史？ | item_id | 来源可辨？ |
|---|---|---|---|---|
| 事项到期提醒（定时器） | `scheduler.ts` → `sendNotifications(context)` | ✅ 是 | 填写 `sub.id` | ✗ 仅靠 `item_id != NULL` 推断 |
| API 调用 | `notify.ts` → `sendNotifications(undefined)` | ✗ **否** | — | — |
| 渠道测试 | `me.ts` → `sendToChannel()` + `insertNotificationHistory()` | ✅ 是（me.ts 第 451–461 行手动写入） | NULL | ✗ 无法与 API 调用区分 |

**关键发现 1**：`notify.ts` 调用 `sendNotifications` 时传入的 `context` 参数为 `undefined`（第 128–135 行），导致 API 触发的通知**完全不写历史记录**。这是一个已有的功能缺口。

**关键发现 2**：`me.ts` 的渠道测试已手动写历史（第 451–461 行），但没有任何字段标记为"测试"来源，与真实通知混在一起无法区分。

**关键发现 3**：`sendNotifications` 的 `context?: NotifyContext` 接口中无 `triggerSource` 字段，`recordHistory` 不传来源信息。

### 1.3 查询层

`listNotificationHistory`（`worker/src/db/queries/notification-history.ts`，第 34–50 行）：

```typescript
export async function listNotificationHistory(
  db, prefix, userId, limit = 50
): Promise<NotificationHistoryRecord[]>
```

- 只支持 `userId` + `limit` 两个参数，无任何过滤条件。
- 前端固定以 `limit=200` 调用（`HistoryPage.tsx` 第 92 行），取回后全量在内存分组，没有服务端筛选。
- `NotificationHistoryRecord` 接口中无 `trigger_source` 字段（与 DB 对应）。

### 1.4 前端层

`HistoryPage.tsx`（448 行）：

- 状态：`history`、`loading`、`error`、`selected`、`confirm`，全部用 `useState`。
- 筛选：**无渠道筛选，无成功/失败筛选**，全量渲染。
- 分组逻辑：同 `item_name` + 同 `title` + 2 分钟内的多条记录合并为一个 `GroupedHistory`。
- 详情弹窗：展示 title、item_name、body、channel badges、时间、error 文本，无专门详情面板，error 已内联。

---

## 二、方案一：`trigger_source` 枚举与数据库迁移

### 2.1 枚举值设计

推荐以下 4 个枚举值：

| 枚举值 | 含义 |
|---|---|
| `item` | 事项到期提醒（定时器触发，scheduler.ts） |
| `api` | API 调用触发（POST /api/notify，notify.ts） |
| `test` | 渠道测试（POST /me/notifications/test，me.ts） |
| `admin` | 管理员测试触发（POST /api/notify/test，如未来扩展） |

当前只需 `item`、`api`、`test` 三个。`admin` 列在此供未来扩展，现在不写入代码。

**字段允许 NULL 的兼容性设计**：由于是追加列，存量记录没有来源信息，列须为可空（`TEXT DEFAULT NULL`），NULL 表示"历史遗留，来源未知"。查询时可用 `COALESCE(trigger_source, 'unknown')` 展示。

### 2.2 迁移 SQL

在 `worker/src/lib/migrations.ts` 的 `getMigrations()` 末尾追加迁移 `schema_v2`：

```typescript
{
  name: "schema_v2",
  sql: `ALTER TABLE ${prefix}notification_history ADD COLUMN trigger_source TEXT
CREATE INDEX IF NOT EXISTS idx_${prefix}notification_history_filter
  ON ${prefix}notification_history(user_id, channel, success, created_at)`,
}
```

**说明**：
- D1 / SQLite 的 `ALTER TABLE ... ADD COLUMN` 要求列为可空或有 `DEFAULT`，`TEXT` 可空完全符合。
- 同时补建复合索引 `(user_id, channel, success, created_at)`，覆盖筛选+排序查询，避免全表扫描。
- 两条 SQL 用换行分隔（不用 `;`），由迁移 runner 的分号分割逻辑正确切割并逐句执行。

> ⚠️ **注意**：根据 migrations.ts 的规则，migration SQL 字符串中不得含 `;`。runner 以 `;` 为分隔符将整个 `sql` 字符串分割成多条语句逐一执行，因此两条语句之间不加 `;` 即可正常运行（或确认具体格式后再调整）。实现时应再次核对 `migrations-runner.ts` 的分割逻辑。

### 2.3 `NotificationHistoryRecord` 接口更新

```typescript
export interface NotificationHistoryRecord {
  id: string;
  user_id: string;
  item_id: string | null;
  trigger_source: string | null;   // 新增
  channel: string;
  title: string;
  body: string | null;
  success: number;
  error: string | null;
  created_at: string;
}
```

---

## 三、方案二：`listNotificationHistory` 支持过滤

### 3.1 过滤参数设计

```typescript
export interface ListHistoryOptions {
  limit?: number;
  channel?: string;
  success?: boolean;            // true=仅成功, false=仅失败, undefined=全部
  triggerSource?: string;       // 'item'|'api'|'test', undefined=全部
}
```

### 3.2 SQL 参数化方案

D1 不支持存储过程或动态 SQL 预编译，推荐**按条件拼接 WHERE 子句字符串 + `bind()` 参数数组**的方式，这是 D1 社区的惯用写法，也与现有 queries/ 目录中其他查询文件的风格一致。

```typescript
export async function listNotificationHistory(
  db: D1Database,
  prefix: string,
  userId: string,
  options: ListHistoryOptions = {},
): Promise<(NotificationHistoryRecord & { item_name?: string })[]> {
  const { limit = 50, channel, success, triggerSource } = options;
  const conditions: string[] = ["h.user_id = ?"];
  const params: (string | number)[] = [userId];

  if (channel !== undefined) {
    conditions.push("h.channel = ?");
    params.push(channel);
  }
  if (success !== undefined) {
    conditions.push("h.success = ?");
    params.push(success ? 1 : 0);
  }
  if (triggerSource !== undefined) {
    conditions.push("h.trigger_source = ?");
    params.push(triggerSource);
  }

  const where = conditions.join(" AND ");
  const sql = `
    SELECT h.*, i.name as item_name
    FROM ${prefix}notification_history h
    LEFT JOIN ${prefix}items i ON i.id = h.item_id
    WHERE ${where}
    ORDER BY h.created_at DESC
    LIMIT ?
  `;
  params.push(Math.min(limit, 200));

  const result = await db.prepare(sql).bind(...params).all<...>();
  return result.results;
}
```

**注意事项**：
- D1 的 `bind()` 接受可变参数，用 spread `...params` 展开数组即可。
- `success` 在 D1/SQLite 中存为 INTEGER（0/1），查询时传 `0`/`1` 而非 `true`/`false`。
- LIKE 在此场景不合适——`channel` 字段是精确匹配（`telegram`、`email` 等固定值），直接用 `=`。
- `triggerSource` 同理，精确匹配即可，无需 LIKE。
- 不建议 WHERE IN 拼接用户输入的渠道名字符串，始终用参数绑定防止 SQL 注入。

### 3.3 后端路由更新

`me.ts` 中的 `GET /me/notification-history` 路由：

```typescript
meRoutes.get("/notification-history", async (c) => {
  const userId = getEffectiveUserId(c);
  const prefix = getTablePrefix(c.env);
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const channel = c.req.query("channel") || undefined;
  const successParam = c.req.query("success");
  const success = successParam === "true" ? true
                : successParam === "false" ? false
                : undefined;
  const triggerSource = c.req.query("trigger_source") || undefined;

  const history = await listNotificationHistory(c.env.DB, prefix, userId, {
    limit, channel, success, triggerSource,
  });
  return c.json(history);
});
```

API 参数：`?channel=telegram&success=false&trigger_source=item&limit=100`

---

## 四、方案三：渠道测试与 API 调用的来源标记

### 4.1 当前测试路由已写历史但缺来源标记

`me.ts` 中 `POST /me/notifications/test` 路由（第 418–461 行）已调用 `insertNotificationHistory`，但未传 `trigger_source`。

**最小改动方案**：`insertNotificationHistory` 函数接受可选的 `trigger_source` 参数。

```typescript
// notification-history.ts
export async function insertNotificationHistory(
  db: D1Database,
  prefix: string,
  record: {
    id: string;
    user_id: string;
    item_id?: string | null;
    trigger_source?: string | null;   // 新增
    channel: string;
    title: string;
    body?: string | null;
    success: boolean;
    error?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO ${prefix}notification_history
     (id, user_id, item_id, trigger_source, channel, title, body, success, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.id, record.user_id, record.item_id ?? null,
    record.trigger_source ?? null,
    record.channel, record.title, record.body ?? null,
    record.success ? 1 : 0, record.error ?? null,
    new Date().toISOString(),
  ).run();
}
```

### 4.2 各调用点改造

**① 渠道测试（me.ts，最小改动）**：

```typescript
await insertNotificationHistory(c.env.DB, prefix, {
  id: generateJti(),
  user_id: userId,
  channel,
  trigger_source: "test",     // ← 新增
  title: message.title,
  success: result.success,
  error: result.error,
});
```

**② API 调用（notify.ts）**：

`notify.ts` 的 `sendNotifications` 调用目前传 `context = undefined`，导致不写历史。需要传入 context：

```typescript
const results = await sendNotifications(
  notifyConfig,
  message,
  c.env,
  {
    db: c.env.DB,
    prefix,
    userId,
    itemId: null,
    triggerSource: "api",    // ← context 扩展字段
  },
  channels,
);
```

**③ 定时器（scheduler.ts）**：

```typescript
await sendNotifications(
  notifyConfig, message, c.env,
  { db: env.DB, prefix, userId, itemId: sub.id, triggerSource: "item" },
  channels,
);
```

### 4.3 `NotifyContext` 接口扩展

```typescript
export interface NotifyContext {
  db: D1Database;
  prefix: string;
  userId: string;
  itemId?: string | null;
  triggerSource?: string | null;   // 新增
}
```

`recordHistory` 内部将 `context.triggerSource` 透传给 `insertNotificationHistory`。

### 4.4 是否改用 `sendNotifications` 替换渠道测试中的 `sendToChannel`？

**结论：不建议替换**。`sendToChannel` 与 `sendNotifications` 的职责不同：

- `sendToChannel`：直接用传入的 `configJson` 发送，不依赖 DB 中的 `NotificationConfig`，适合"配置还未保存、页面上临时填写的配置"的测试场景。
- `sendNotifications`：从 DB 读 `NotificationConfig`，需要配置已持久化。

当前测试路由从 DB 读 `config`（第 428–430 行），再取 `channelConfig` 传给 `sendToChannel`，与直接调 `sendNotifications` 效果类似——但 `sendToChannel` 更轻量，不需要 `enabled_channels` / `default_channel` 的校验逻辑。

**推荐**：保持 `sendToChannel` 不变，仅在测试路由的 `insertNotificationHistory` 调用点补充 `trigger_source: "test"`。这样改动最小，不引入新的副作用。

---

## 五、方案四：前端筛选 UI

### 5.1 筛选状态存放位置

**推荐：URL query 参数**。理由：

1. 筛选结果可以分享/书签，刷新后恢复。
2. 浏览器前进/后退保留筛选状态，符合用户心智。
3. 不需要全局状态管理（Zustand），也不需要父子组件通信，组件内 `useSearchParams` 即可。

React Router v7 提供 `useSearchParams` hook，与现有路由体系完全兼容。

**不推荐 useState**：筛选条件是"持久化的 UI 偏好"而非"临时的交互状态"，放 URL 更合理。

**不推荐 Zustand**：历史页是独立页面，没有跨路由共享筛选状态的需求，引入全局 store 过重。

### 5.2 URL 参数设计

```
/history?channel=telegram&success=false
```

- `channel`：渠道名（`telegram`、`email` 等），缺省为全部。
- `success`：`true`/`false`，缺省为全部。
- 暂不在 URL 中暴露 `trigger_source`（留给后续迭代，或在高级筛选中添加）。

### 5.3 渠道下拉与成功/失败 Toggle 的位置

**推荐位置**：紧贴历史列表上方，与日期分组标题平行的一行工具栏（`flex` 布局，水平排列）：

```
[全部渠道 ▾]   [全部状态 ▾]           搜索...  （右侧）
```

- **渠道下拉**：使用 shadcn/ui 的 `<Select>` 组件，选项动态从当前历史记录中提取已出现的渠道名（去重），加一个"全部渠道"选项。不必硬编码所有渠道名，避免与后端 VALID_CHANNELS 脱节。
- **状态切换**：使用 shadcn/ui 的 `<ToggleGroup>`（或三个 `<Toggle>`），选项：全部 / 成功 / 失败。比下拉更直观，选项固定只有三个。

**移动端**：筛选工具栏折叠为一个"筛选"按钮（`Filter` 图标），点击展开 sheet/drawer（shadcn/ui `<Sheet>`），内含同样的渠道和状态选项。

### 5.4 筛选实现方式：前端过滤 vs 后端过滤

| 方式 | 优点 | 缺点 |
|---|---|---|
| 前端过滤（加载全量后 filter） | 交互即时，无网络延迟 | limit=200 时若实际历史 >200 条，筛选结果不完整 |
| 后端过滤（带参数查询） | 结果完整，适合数据量大的情况 | 每次筛选变更需重新请求 |

**推荐：后端过滤**，理由见第六节分页评估。筛选条件变更时重新调用 API（`fetchHistory` 依赖筛选参数），配合 `useSearchParams` 监听变化。

---

## 六、分页评估

### 6.1 当前 limit=200 是否够用？

- 当前固定 `limit=200`，无分页 UI。
- 加入筛选后，若某用户总历史超过 200 条，而筛选后的记录恰好集中在第 201+ 条，则筛选结果会遗漏数据。
- 如果改为**后端筛选**（方案四的推荐），服务端先过滤再 limit，筛选结果是准确的，limit=200 仅是"过滤后最多返回 200 条"，对大多数用户够用。

### 6.2 分页建议

**短期（本次实现）**：无需引入分页 UI，改为后端筛选即可解决遗漏问题。limit 保持 200，对正常用户（每天 1-5 次通知，200 条 ≈ 40-200 天）完全足够。

**长期（数据增多后）**：建议引入基于 `cursor`（`created_at` + `id` 组合）的游标分页，而非 offset 分页——D1/SQLite 的 offset 在大表上性能差。届时后端 API 返回 `{ data, nextCursor }` 格式，前端用"加载更多"按钮触发。

---

## 七、方案总结与优先级

| # | 方案 | 难度 | 优先级 | 备注 |
|---|---|---|---|---|
| 1 | 迁移：新增 `trigger_source` 列 + 复合索引 | 低 | P0 | 前提条件，其他方案依赖它 |
| 2 | 后端：`insertNotificationHistory` 支持 `trigger_source` | 低 | P0 | |
| 3 | 后端：`notify.ts` 补写历史（当前完全不写） | 低 | P0 | 功能缺口，补全来源溯源 |
| 4 | 后端：`me.ts` 测试路由补写 `trigger_source: "test"` | 低 | P0 | 最小改动，仅加一个参数 |
| 5 | 后端：`scheduler.ts` 补写 `trigger_source: "item"` | 低 | P0 | |
| 6 | 后端：`listNotificationHistory` 支持 `channel`/`success` 过滤 | 低 | P0 | |
| 7 | 后端：路由解析筛选参数并透传 | 低 | P0 | |
| 8 | 前端：URL query 筛选状态 + 渠道下拉 + 状态 Toggle | 中 | P1 | |
| 9 | 前端：筛选变更时重新请求后端（非内存过滤） | 低 | P1 | 与 8 配套 |
| 10 | 长期：游标分页 | 中 | P2 | 数据量大后再做 |

---

## 八、开放问题

1. **`schema_v2` 迁移中两条 SQL 的格式**：需实现者核对 `migrations-runner.ts` 的分号分割逻辑，确认 `ALTER TABLE` 和 `CREATE INDEX` 两条语句放在同一 migration 的 sql 字段中时，分隔符是否使用换行（无分号）能被正确切割。若不行，可将两条语句拆分为两个 migration（`schema_v2` 和 `schema_v3`）。

2. **`trigger_source` 是否需要 DB 层枚举校验**：SQLite 无 ENUM 类型，仅靠应用层约束。若后续需要严格枚举，可考虑加 CHECK 约束（`CHECK(trigger_source IN ('item','api','test'))`），但这在迁移中属于较重的约束变更，建议单独评估。

3. **前端 `NotificationHistory` 类型文件位置**：`web/src/types` 中的对应接口需同步增加 `trigger_source?: string | null` 字段，实现时确认该类型的定义位置。

4. **渠道测试来源标记（`me.ts` 第 451–461 行）**：当前 `me.ts` 已写历史且使用 `generateJti()` 生成 id（与 `notify/index.ts` 使用的 `generateId()` 不同），实现时统一为 `generateId()` 还是保持 `generateJti()`，由实现者决定（两者功能相同，选一种即可）。

---

*本报告只描述方案，不包含任何代码实现。具体实现由后续实现单负责，并以本报告的方案设计为输入。*

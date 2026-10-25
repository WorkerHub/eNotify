# 导出 / 导入后端契约（v1，冻结格式 + 六个接口）

> 状态：已实现（子单 ONE-359，父单 ONE-358）。本文件是前端子单的唯一对接依据：路由名、请求/响应形状、错误码都以本文为准。
> 数据格式契约见父单「导出文件格式 / 敏感性与加密 / 导入语义」三节，本文件不重复其规范，只描述 HTTP 表面。

## 1. 六个接口

| 路由 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/me/export` | POST | 登录会话 | 个人档导出（`scope: "user"`） |
| `/api/me/import/preview` | POST | 登录会话 | 个人档导入预检（dry-run，merge 模式） |
| `/api/me/import` | POST | 登录会话 | 个人档导入（merge 模式） |
| `/api/admin/export` | POST | 会话 + admin | 全站导出（`scope: "instance"`） |
| `/api/admin/import/preview` | POST | 会话 + admin | 全站导入预检（restore 或 merge） |
| `/api/admin/import` | POST | 会话 + admin | 全站导入（restore 默认 / merge 可选） |

**只认 cookie 会话，不认 API Key**：请求带 `Authorization: Bearer enk_...` 时直接返回 `403 { code: "API_KEY_NOT_ALLOWED" }`（即使同时带着有效会话）。未登录 `401`，非管理员访问 admin 路由 `403`。

## 2. 上传方式

JSON 请求体（现值前端 `web/src/lib/api.ts` 的惯例，全部请求都是 JSON）：

```jsonc
{
  "file": { /* 解析后的导出文件 */ },   // 也可以传原始文件文本："file": "<json text>"
  "passphrase": "…",                    // 加密文件必填；明文文件忽略
  "mode": "restore"                     // 仅 admin 导入/预检使用，见下
}
```

- 整个请求体上限 **10 MB（10485760 字节）**，超出返回 `413 { code: "PAYLOAD_TOO_LARGE", details: { max_bytes } }`。
- 前端读 `File.text()` 后既可直接 `JSON.parse` 再传对象，也可把文本原样放进 `file` 字符串，两种都支持。

## 3. 导出

请求体：

```jsonc
{
  "encrypted": true,        // 默认 true；要明文文件必须显式传 false
  "passphrase": "…",        // encrypted 时必填，否则 400 PASSPHRASE_REQUIRED
  "include_history": false  // 默认 false：data.notification_history 为空数组
}
```

响应：**文件内容直接作为响应体**（不是外层包装），头：

```
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="enotify-user-20261025T153000Z-encrypted.json"
Cache-Control: no-store
```

- `encrypted: true` 时响应体是可识别信封 `{format:"enotify-export-encrypted", format_version:1, kdf:{name:"PBKDF2",hash:"SHA-256",iterations:210000,salt}, cipher:{name:"AES-GCM",length:256,iv,tag_length:128}, payload}`；`salt`/`iv`/`payload` 均为 base64。
- `encrypted: false` 时响应体即明文导出文件（`enotify-export`）。
- 前端把它当 blob 下载即可（`tagged-` 无需再拼信封）。

## 4. 导入预检（dry-run）

请求体见 §2（`mode` 仅 admin 用；个人档固定 merge）。

响应 `200`：

```jsonc
{
  "ok": true,
  "mode": "restore",              // "restore" | "merge"
  "scope": "instance",            // 文件自身声明的 scope
  "encrypted": true,              // 上传的是否为加密信封
  "format_version": 1,
  "app_version": "1.0.4",
  "exported_at": "2026-10-25T15:00:00.000Z",
  "counts":     { "users": 3, "user_2fa": 1, "items": 3, "payment_history": 2,
                  "notification_configs": 2, "system_settings": 2, "notification_history": 0 },
  "will_write": { /* 同上七个键：本次真正会写入的行数 */ },
  "users": [ { "id": "u1", "email": "a@example.com", "role": "admin" } ],
  "can_execute": true,            // false 时前端必须禁用「确认导入」
  "blockers": [ { "code": "RESTORE_TARGET_NOT_EMPTY", "message": "…" } ],
  "conflicts": {
    "target_users": 0,            // 目标实例当前用户数（restore 用）
    "email_conflicts": [],        // 预留：同邮箱冲突清单
    "settings_overwritten": [],   // restore：会被文件覆盖的 system_settings 键
    "config_overwritten": false,  // merge：是否会整行覆盖当前用户的渠道配置
    "skipped_orphan_payments": 0, // merge：因找不到对应通知而跳过的缴费记录数
    "skipped_foreign_items": 0,   // merge：文件中属于其他账号、被忽略的通知数
    "skipped_foreign_payments": 0,
    "skipped_history_rows": 0     // merge：不导入的通知历史条数
  },
  "ignored_tables": ["users", "user_2fa", "system_settings", "notification_history"],
  "warnings": ["…"]               // 展示给用户看的提示（含「API Key 不含在文件里」等）
}
```

前端预检页据此展示：每表行数、用户邮箱清单、冲突点（`conflicts` + `blockers`）、`ignored_tables`（merge 时明示被忽略的表）、`warnings`。

## 5. 导入执行

请求体同 §2。admin 路由 `mode` 缺省为 `restore`；`mode: "merge"` 时把文件里的个人数据合并进**当前登录账号**（个人档路由固定 merge，传其他值返回 `400 MODE_NOT_ALLOWED`）。

响应 `200`：

```jsonc
{
  "ok": true,
  "mode": "restore",
  "scope": "instance",
  "written": { "users": 3, "user_2fa": 1, "items": 3, "payment_history": 2,
               "notification_configs": 2, "system_settings": 2, "notification_history": 0 },
  "total_written": 13,
  "notices": ["恢复完成：API Key 需重新签发，所有用户需要重新登录"],
  "warnings": ["…"]
}
```

restore 成功后的 `notices` 必须原样展示（API Key 重新签发 + 所有用户重新登录）。merge 的 `notices` 为空数组，提示都在 `warnings` 里。

## 6. 错误码

响应体统一 `{ "error": "<可直接展示的中文文案>", "code": "<机器码>", "details"?: {...} }`。

| HTTP | code | 场景 |
|---|---|---|
| 400 | `PASSPHRASE_REQUIRED` | 加密导出没给口令 / 加密文件导入没给口令 |
| 400 | `DECRYPT_FAILED` | 口令错误或文件被篡改（**零写入**） |
| 400 | `INVALID_ENVELOPE` | 加密信封字段缺失/参数不受支持 |
| 400 | `INVALID_FORMAT` / `INVALID_FILE` / `INVALID_ROW` | 不是 eNotify 导出文件 / JSON 形状不对 |
| 400 | `UNSUPPORTED_FORMAT_VERSION` | 文件 `format_version` 高于本服务支持（1） |
| 400 | `MODE_NOT_ALLOWED` | 个人档路由收到 restore，或用 user 档文件走 restore |
| 400 | `MERGE_SOURCE_NOT_FOUND` | 文件里没有属于当前账号（邮箱）的数据 |
| 400 | `INVALID_REQUEST` | 请求体不是 JSON / 缺少 `file` |
| 401 | — | 未登录 |
| 403 | `API_KEY_NOT_ALLOWED` | 用 API Key 调这些接口 |
| 403 | — | 非管理员访问 admin 路由 |
| 409 | `RESTORE_TARGET_NOT_EMPTY` | restore 打到非空实例（**不提供覆盖**） |
| 409 | `REFERENCE_MISSING` / `DUPLICATE_KEY` / `MISSING_COLUMN` | 文件行校验失败（预检给 blockers，导入拒绝） |
| 409 | `STALE_PREVIEW` | 预检后数据库变化，需重新预检 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超过 10 MB |
| 429 | — | 同一账号每分钟超过 20 次导出/导入调用（`{ error: "Too many requests" }`） |
| 500 | `WRITE_FAILED` | 写入失败，事务已整体回滚（数据没有任何变化） |
| 500 | `RESTORE_COUNT_MISMATCH` | 写后行数断言不符 |

## 7. 导入原子性与安全要点（前端可依赖的行为）

- 恢复模式只接受 `scope: "instance"`，且目标 `users` 表必须非空拒绝（预检 `can_execute: false`，执行 `409`）。
- 单次导入的全部写入是 **一次 `db.batch`（D1 单事务）**：任一行失败整批回滚，不会出现半套数据或悬空外键。
- 错口令在解密阶段失败，**不会写任何数据**。
- 合并模式：ID 全部重新生成，`user_id` 改写为当前账号，`payment_history.item_id` 按旧→新映射改写，`notification_configs` 整行覆盖（预检 `conflicts.config_overwritten` 已明示）；`users`/`user_2fa`/`system_settings`/`notification_history` 忽略。
- 审计：导出/导入各写一条 `[audit] backup {...}` 结构化 server log（操作者、scope/mode、是否加密、各表行数），口令永不出现在日志里。

## 8. 前端必须写进 UI 的提示（规格「不在导出范围」节）

- 文件等同主钥匙包，妥善保管，不要经聊天/邮件传输。
- 不含 API Key（明文不可恢复，恢复后需重新签发）、不含会话/JWT（导入后所有用户需重新登录）、不含 KV 中的运行时状态。
- 加密导出默认勾选；口令框需说明「口令不会保存，忘记无法恢复文件」。

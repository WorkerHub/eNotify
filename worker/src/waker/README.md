# worker/src/waker —— waker 客户端 SDK（**外部源码拷贝，勿改**）

本目录是 waker 官方客户端 SDK 的**逐字拷贝**，不是 eNotify 自己的实现：

| 项 | 值 |
|---|---|
| 来源 | https://github.com/WorkerHub/waker 的 `client/src/` |
| 版本 | `@workerhub/waker-client` 2.0.0（commit `2b1eb68`，2026-10-27） |
| 接入方式 | SDK README 指定的「把 `client/src` 拷进下游项目（如 `src/waker/`）」 |
| 依赖 | 唯一 peer 是 `hono`（`^4.13.14`），不 import waker 平台内部任何模块 |

七个文件与上游一一对应：`protocol.ts` / `verify.ts` / `ledger.ts` / `receiver.ts` / `client.ts` / `modes.ts` / `index.ts`。

**规则**

1. 本目录内任何文件都**不得手改**：需要修 SDK 就回 waker 仓库改、发版，再整目录重新拷贝
   （`cp client/src/*.ts enotify/worker/src/waker/`），并把上面表格的版本与 commit 一起更新。
2. 升级时必须对照 waker 的冻结契约测试（`tests/client.test.ts` 断言 SDK 与平台逐项一致）确认版本；
   协议常量（签名规范串、头名、时间窗、`/_waker` 路径）漂移会让回调静默失败。
3. eNotify 侧**只用** receiver（`createWakerReceiver`）、D1 幂等账本（`createD1ExecutionLedger`）
   与路径常量（`CALLBACK_MOUNT_PATH` / `CALLBACK_PATH`）；`executionLedgerDdl()` 仅作建表参照。
   业务接线在 `worker/src/services/waker-callback.ts`，挂载在 `worker/src/routes/waker.ts`。
4. **永不调用**：`mountWakerReceiver`（被已废弃的 `WAKER_MODE` 门控，且缺 key 时模块初始化即抛错）、
   `createWakerClient*` / `syncManifest` / `createOneShot` / `cancelJob`（不配项目令牌、不做动态注册/
   取消/自续）、`resolveWakerMode` / `isWakerEnabled`（模式判定已废弃：开关只看 `WAKER_SIGNING_KEY`
   在不在，见 `wakerSigningKey()`）。这些文件随目录拷入只为保持逐字一致。

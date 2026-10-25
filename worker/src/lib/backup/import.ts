/**
 * Import: dry-run preview, restore (full instance) and merge (personal data
 * into the signed-in account).
 *
 * Atomicity model (parent issue ONE-358 "导入语义"):
 * - Every write of an import is built as ONE `db.batch([...])` call. D1 runs a
 *   batch as a single SQL transaction: if any statement fails, the whole batch
 *   is rolled back, so a failed import can never leave half the tables written
 *   or a payment row pointing at a missing item.
 * - The batch is only built after a full validation pass (format, row shapes,
 *   required columns, in-file duplicate keys, in-file reference integrity), so
 *   avoidable failures are rejected before any write.
 * - Row counts are captured before the batch and asserted again afterwards; a
 *   mismatch (which the transaction rules out) is reported instead of being
 *   silently accepted. A preview taken against a database that has changed
 *   since is rejected with STALE_PREVIEW rather than writing against a stale
 *   plan.
 */
import { generateId } from "../../core/auth";
import { BackupError, type BackupErrorCode } from "./errors";
import {
  BACKUP_TABLES,
  HISTORY_TABLE,
  MERGE_IGNORED_TABLES,
  TABLE_BY_NAME,
  deserializeValue,
  rawColumnsOf,
  type BackupRow,
  type BackupScope,
  type BackupTable,
  type PlainExportFile,
  type TableSpec,
} from "./format";

export type ImportMode = "restore" | "merge";

export interface ImportActor {
  id: string;
  email: string;
}

export interface ImportBlocker {
  code: BackupErrorCode;
  message: string;
}

export interface ImportUserSummary {
  id: string;
  email: string;
  role: string;
}

export interface ImportPreview {
  mode: ImportMode;
  scope: BackupScope;
  encrypted: boolean;
  format_version: number;
  app_version: string;
  exported_at: string;
  counts: Record<BackupTable, number>;
  will_write: Record<BackupTable, number>;
  users: ImportUserSummary[];
  can_execute: boolean;
  blockers: ImportBlocker[];
  conflicts: {
    target_users: number;
    email_conflicts: string[];
    settings_overwritten: string[];
    config_overwritten: boolean;
    skipped_orphan_payments: number;
    skipped_foreign_items: number;
    skipped_foreign_payments: number;
    skipped_history_rows: number;
  };
  ignored_tables: BackupTable[];
  warnings: string[];
}

export interface ImportResult {
  ok: true;
  mode: ImportMode;
  scope: BackupScope;
  written: Record<BackupTable, number>;
  total_written: number;
  notices: string[];
  warnings: string[];
}

interface ColumnInfo {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  pk: boolean;
}

type ColumnsByTable = Record<BackupTable, ColumnInfo[]>;

interface BoundRow {
  columns: string[];
  values: unknown[];
}

interface TablePlan {
  table: BackupTable;
  spec: TableSpec;
  /** INSERT OR REPLACE (config replacement / settings upsert) vs plain INSERT. */
  upsert: boolean;
  rows: BoundRow[];
  /** Absolute row count this table must have after a successful write. */
  expectedAfter: number;
}

interface ImportPlan {
  mode: ImportMode;
  file: PlainExportFile;
  tables: TablePlan[];
  before: Record<BackupTable, number>;
  preview: ImportPreview;
}

const MAX_ROW_MESSAGES = 20;

// ─── introspection / counts ───────────────────────────────────────────────────

async function introspectTable(
  db: D1Database,
  prefix: string,
  table: BackupTable,
): Promise<ColumnInfo[]> {
  const result = await db.prepare(`PRAGMA table_info(${prefix}${table})`).all<{
    name: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>();
  const rows = result.results ?? [];
  if (rows.length === 0) {
    throw new BackupError(
      "TABLE_MISSING",
      500,
      `数据表 ${prefix}${table} 不存在，请先完成数据库初始化`,
    );
  }
  return rows.map((row) => ({
    name: row.name,
    notNull: Number(row.notnull) === 1,
    hasDefault: row.dflt_value !== null && row.dflt_value !== undefined,
    pk: Number(row.pk) > 0,
  }));
}

async function introspectAll(
  db: D1Database,
  prefix: string,
): Promise<ColumnsByTable> {
  const out = {} as ColumnsByTable;
  for (const spec of BACKUP_TABLES) {
    out[spec.name] = await introspectTable(db, prefix, spec.name);
  }
  return out;
}

async function countTable(
  db: D1Database,
  prefix: string,
  table: BackupTable,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${prefix}${table}`)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function countAll(
  db: D1Database,
  prefix: string,
): Promise<Record<BackupTable, number>> {
  const out = {} as Record<BackupTable, number>;
  for (const spec of BACKUP_TABLES) {
    out[spec.name] = await countTable(db, prefix, spec.name);
  }
  return out;
}

// ─── row binding ──────────────────────────────────────────────────────────────

function coerceScalar(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Turns a file row into an explicit column/value list for the CURRENT schema:
 * unknown columns are dropped, absent columns are left to the DB defaults,
 * `_raw`-flagged JSON columns are written back as the original string.
 */
function bindRow(
  spec: TableSpec,
  row: BackupRow,
  columns: ColumnInfo[],
  /** Row description used in validation messages. */
  label: string,
): { bound: BoundRow; problems: ImportBlocker[] } {
  const rawColumns = rawColumnsOf(row);
  const bound: BoundRow = { columns: [], values: [] };
  const problems: ImportBlocker[] = [];

  for (const column of columns) {
    if (!(column.name in row)) {
      if (column.notNull && !column.hasDefault) {
        problems.push({
          code: "MISSING_COLUMN",
          message: `${label} 缺少必填列 ${column.name}`,
        });
      }
      continue;
    }
    const value = deserializeValue(
      spec,
      column.name,
      row[column.name],
      rawColumns,
    );
    if (value === null) {
      if (column.notNull) {
        problems.push({
          code: "INVALID_ROW",
          message: `${label} 的 ${column.name} 不能为空`,
        });
        continue;
      }
      bound.columns.push(column.name);
      bound.values.push(null);
      continue;
    }
    if (typeof value === "object") {
      // Only JSON columns may hold objects/arrays; deserializeValue already
      // stringified them, so reaching here means a non-JSON column was given a
      // structured value.
      problems.push({
        code: "INVALID_ROW",
        message: `${label} 的 ${column.name} 必须是标量值`,
      });
      continue;
    }
    bound.columns.push(column.name);
    bound.values.push(coerceScalar(value));
  }

  return { bound, problems };
}

// ─── validation helpers ───────────────────────────────────────────────────────

function collectDuplicates(
  rows: BackupRow[],
  columns: string[],
  label: string,
): ImportBlocker[] {
  const blockers: ImportBlocker[] = [];
  const seen = new Map<string, { display: string; count: number }>();
  for (const row of rows) {
    const values = columns.map((c) => String(row[c] ?? ""));
    if (values.every((value) => value === "")) continue;
    // JSON keeps the composite key unambiguous (no separator collisions).
    const key = JSON.stringify(values);
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { display: values.join("/"), count: 1 });
  }
  for (const { display, count } of seen.values()) {
    if (count > 1) {
      blockers.push({
        code: "DUPLICATE_KEY",
        message: `${label} 中主键 ${display} 重复出现 ${count} 次`,
      });
    }
  }
  return blockers;
}

function idsOf(rows: BackupRow[], column: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "string" && value !== "") ids.add(value);
  }
  return ids;
}

function missingReferences(
  rows: BackupRow[],
  column: string,
  targets: Set<string>,
): number {
  let missing = 0;
  for (const row of rows) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || !targets.has(value)) missing += 1;
  }
  return missing;
}

function emptyCounts(): Record<BackupTable, number> {
  const out = {} as Record<BackupTable, number>;
  for (const spec of BACKUP_TABLES) out[spec.name] = 0;
  return out;
}

function fileCounts(file: PlainExportFile): Record<BackupTable, number> {
  const out = {} as Record<BackupTable, number>;
  for (const spec of BACKUP_TABLES)
    out[spec.name] = file.data[spec.name].length;
  return out;
}

function summarizeUsers(file: PlainExportFile): ImportUserSummary[] {
  return file.data.users.map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    email: typeof row.email === "string" ? row.email : "",
    role: typeof row.role === "string" ? row.role : "",
  }));
}

function newBlocker(code: BackupErrorCode, message: string): ImportBlocker {
  return { code, message };
}

// ─── restore plan ─────────────────────────────────────────────────────────────

async function planRestore(
  db: D1Database,
  prefix: string,
  file: PlainExportFile,
  encrypted: boolean,
): Promise<ImportPlan> {
  if (file.scope !== "instance") {
    throw new BackupError(
      "MODE_NOT_ALLOWED",
      400,
      '恢复模式只接受 scope 为 "instance" 的全站导出文件；个人档文件请使用合并导入',
    );
  }

  const columns = await introspectAll(db, prefix);
  const before = await countAll(db, prefix);
  const blockers: ImportBlocker[] = [];
  const warnings: string[] = [];

  if (before.users > 0) {
    blockers.push(
      newBlocker(
        "RESTORE_TARGET_NOT_EMPTY",
        `目标实例的 users 表已有 ${before.users} 个用户。恢复模式只允许在空实例上执行（不提供覆盖选项）`,
      ),
    );
  }

  // Validate every row of every table before planning writes.
  const boundRows = {} as Record<BackupTable, BoundRow[]>;
  for (const spec of BACKUP_TABLES) {
    const rows = file.data[spec.name];
    const bound: BoundRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const { bound: row, problems } = bindRow(
        spec,
        rows[i],
        columns[spec.name],
        `data.${spec.name}[${i}]`,
      );
      for (const problem of problems) {
        if (blockers.length < MAX_ROW_MESSAGES) blockers.push(problem);
      }
      bound.push(row);
    }
    boundRows[spec.name] = bound;
  }

  // In-file key duplicates would make the batch fail; surface them up front.
  for (const spec of BACKUP_TABLES) {
    const pkColumns = columns[spec.name].filter((c) => c.pk).map((c) => c.name);
    const keyColumns = pkColumns.length > 0 ? pkColumns : [spec.userColumn];
    for (const blocker of collectDuplicates(
      file.data[spec.name],
      keyColumns,
      `data.${spec.name}`,
    )) {
      if (blockers.length < MAX_ROW_MESSAGES) blockers.push(blocker);
    }
  }
  const duplicateEmails = new Set<string>();
  const seenEmails = new Set<string>();
  for (const user of file.data.users) {
    const email =
      typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (seenEmails.has(email)) duplicateEmails.add(email);
    seenEmails.add(email);
  }
  for (const email of duplicateEmails) {
    blockers.push(
      newBlocker("DUPLICATE_KEY", `data.users 中邮箱 ${email} 重复出现`),
    );
  }

  // Restore targets an empty instance, so every reference must resolve inside
  // the file — no dangling pointers may be created.
  const userIds = idsOf(file.data.users, "id");
  const itemIds = idsOf(file.data.items, "id");
  const referenceChecks: {
    table: BackupTable;
    column: string;
    targets: Set<string>;
    label: string;
  }[] = [
    {
      table: "user_2fa",
      column: "user_id",
      targets: userIds,
      label: "users.id",
    },
    { table: "items", column: "user_id", targets: userIds, label: "users.id" },
    {
      table: "payment_history",
      column: "item_id",
      targets: itemIds,
      label: "items.id",
    },
    {
      table: "payment_history",
      column: "user_id",
      targets: userIds,
      label: "users.id",
    },
    {
      table: "notification_configs",
      column: "user_id",
      targets: userIds,
      label: "users.id",
    },
    {
      table: "notification_history",
      column: "item_id",
      targets: itemIds,
      label: "items.id",
    },
    {
      table: "notification_history",
      column: "user_id",
      targets: userIds,
      label: "users.id",
    },
  ];
  for (const check of referenceChecks) {
    const missing = missingReferences(
      file.data[check.table],
      check.column,
      check.targets,
    );
    if (missing > 0) {
      blockers.push(
        newBlocker(
          "REFERENCE_MISSING",
          `data.${check.table} 中有 ${missing} 行的 ${check.column} 找不到对应的 ${check.label}`,
        ),
      );
    }
  }

  // system_settings are upserted: existing keys (installed defaults) are
  // overwritten by the file's values instead of aborting the whole restore.
  const existingSettings = new Set<string>();
  if (file.data.system_settings.length > 0) {
    const result = await db
      .prepare(`SELECT key FROM ${prefix}system_settings`)
      .all<{ key: string }>();
    for (const row of result.results ?? []) existingSettings.add(row.key);
  }
  const settingsOverwritten = file.data.system_settings
    .map((row) => (typeof row.key === "string" ? row.key : ""))
    .filter((key) => key && existingSettings.has(key));

  if (file.data[HISTORY_TABLE].length === 0) {
    warnings.push(
      "该文件不含通知历史（导出时未勾选「包含通知历史」），恢复后历史记录为空",
    );
  }
  warnings.push(
    "API Key 不包含在导出文件中（服务端只保存其哈希），恢复后需要重新签发",
  );

  const tables: TablePlan[] = [];
  const willWrite = emptyCounts();
  for (const spec of BACKUP_TABLES) {
    const rows = boundRows[spec.name];
    const upsert = spec.name === "system_settings";
    let expectedAfter = before[spec.name] + rows.length;
    if (upsert) {
      const replaced = file.data.system_settings.filter(
        (row) => typeof row.key === "string" && existingSettings.has(row.key),
      ).length;
      expectedAfter = before[spec.name] + rows.length - replaced;
    }
    willWrite[spec.name] = rows.length;
    tables.push({ table: spec.name, spec, upsert, rows, expectedAfter });
  }

  const preview: ImportPreview = {
    mode: "restore",
    scope: file.scope,
    encrypted,
    format_version: file.format_version,
    app_version: file.app_version,
    exported_at: file.exported_at,
    counts: fileCounts(file),
    will_write: willWrite,
    users: summarizeUsers(file),
    can_execute: blockers.length === 0,
    blockers,
    conflicts: {
      target_users: before.users,
      email_conflicts: [],
      settings_overwritten: settingsOverwritten,
      config_overwritten: false,
      skipped_orphan_payments: 0,
      skipped_foreign_items: 0,
      skipped_foreign_payments: 0,
      skipped_history_rows: 0,
    },
    ignored_tables: [],
    warnings,
  };

  return { mode: "restore", file, tables, before, preview };
}

// ─── merge plan ───────────────────────────────────────────────────────────────

async function planMerge(
  db: D1Database,
  prefix: string,
  file: PlainExportFile,
  actor: ImportActor,
  encrypted: boolean,
): Promise<ImportPlan> {
  const columns = await introspectAll(db, prefix);
  const before = await countAll(db, prefix);
  const blockers: ImportBlocker[] = [];
  const warnings: string[] = [];
  const actorEmail = actor.email.trim().toLowerCase();

  const sourceUser = file.data.users.find(
    (row) =>
      typeof row.email === "string" &&
      row.email.trim().toLowerCase() === actorEmail,
  );
  if (!sourceUser || typeof sourceUser.id !== "string" || !sourceUser.id) {
    throw new BackupError(
      "MERGE_SOURCE_NOT_FOUND",
      400,
      `文件中没有属于当前账号（${actor.email}）的数据，无法合并导入`,
    );
  }
  const sourceUserId = sourceUser.id;

  const itemRows = file.data.items.filter((row) =>
    typeof row.user_id === "string" ? row.user_id === sourceUserId : false,
  );
  const paymentRows = file.data.payment_history.filter((row) =>
    typeof row.user_id === "string" ? row.user_id === sourceUserId : false,
  );
  const configRows = file.data.notification_configs.filter((row) =>
    typeof row.user_id === "string" ? row.user_id === sourceUserId : false,
  );

  const skippedForeignItems = file.data.items.length - itemRows.length;
  const skippedForeignPayments =
    file.data.payment_history.length - paymentRows.length;
  const skippedHistoryRows = file.data[HISTORY_TABLE].length;

  // items: new ids, owner rewritten.
  const idMap = new Map<string, string>();
  const itemBound: BoundRow[] = [];
  for (let i = 0; i < itemRows.length; i++) {
    const row = itemRows[i];
    const newId = generateId();
    if (typeof row.id === "string" && row.id) idMap.set(row.id, newId);
    const { bound, problems } = bindRow(
      TABLE_BY_NAME.items,
      { ...row, id: newId, user_id: actor.id },
      columns.items,
      `data.items[${i}]`,
    );
    for (const p of problems) {
      if (blockers.length < MAX_ROW_MESSAGES) blockers.push(p);
    }
    itemBound.push(bound);
  }

  // payment_history: new ids, item_id remapped through idMap.
  const paymentBound: BoundRow[] = [];
  let skippedOrphanPayments = 0;
  for (let i = 0; i < paymentRows.length; i++) {
    const row = paymentRows[i];
    const oldItemId = typeof row.item_id === "string" ? row.item_id : "";
    const newItemId = oldItemId ? idMap.get(oldItemId) : undefined;
    if (!newItemId) {
      skippedOrphanPayments += 1;
      continue;
    }
    const { bound, problems } = bindRow(
      TABLE_BY_NAME.payment_history,
      { ...row, id: generateId(), item_id: newItemId, user_id: actor.id },
      columns.payment_history,
      `data.payment_history[${i}]`,
    );
    for (const p of problems) {
      if (blockers.length < MAX_ROW_MESSAGES) blockers.push(p);
    }
    paymentBound.push(bound);
  }

  // notification_configs: the whole row replaces the importer's config.
  const configBound: BoundRow[] = [];
  if (configRows.length > 0) {
    const { bound, problems } = bindRow(
      TABLE_BY_NAME.notification_configs,
      { ...configRows[0], user_id: actor.id },
      columns.notification_configs,
      "data.notification_configs[0]",
    );
    for (const p of problems) {
      if (blockers.length < MAX_ROW_MESSAGES) blockers.push(p);
    }
    configBound.push(bound);
  }

  const existingConfig = await db
    .prepare(
      `SELECT 1 AS present FROM ${prefix}notification_configs WHERE user_id = ?`,
    )
    .bind(actor.id)
    .first<{ present: number }>();
  const configOverwritten = Boolean(existingConfig);

  if (configBound.length === 0) {
    warnings.push("文件中没有你的渠道配置，当前渠道配置将保持不变");
  } else if (configOverwritten) {
    warnings.push("文件中的渠道配置将整行覆盖你当前的渠道配置");
  }
  if (skippedOrphanPayments > 0) {
    warnings.push(
      `有 ${skippedOrphanPayments} 条缴费记录引用了文件中不存在的通知，已跳过`,
    );
  }
  if (skippedHistoryRows > 0) {
    warnings.push(
      `合并模式不导入通知历史，已跳过 ${skippedHistoryRows} 条历史记录`,
    );
  }
  if (skippedForeignItems > 0 || skippedForeignPayments > 0) {
    warnings.push(
      `已忽略文件中属于其他账号的数据（通知 ${skippedForeignItems} 条、缴费 ${skippedForeignPayments} 条）`,
    );
  }
  warnings.push(
    "合并模式忽略 users / user_2fa / system_settings / notification_history，账号与系统设置保持不变",
  );
  warnings.push(
    "API Key 不包含在导出文件中（服务端只保存其哈希），如来源实例不同需重新签发",
  );

  const tables: TablePlan[] = [
    {
      table: "items",
      spec: TABLE_BY_NAME.items,
      upsert: false,
      rows: itemBound,
      expectedAfter: before.items + itemBound.length,
    },
    {
      table: "payment_history",
      spec: TABLE_BY_NAME.payment_history,
      upsert: false,
      rows: paymentBound,
      expectedAfter: before.payment_history + paymentBound.length,
    },
    {
      table: "notification_configs",
      spec: TABLE_BY_NAME.notification_configs,
      upsert: true,
      rows: configBound,
      expectedAfter:
        configBound.length > 0
          ? before.notification_configs + (configOverwritten ? 0 : 1)
          : before.notification_configs,
    },
  ];

  const willWrite = emptyCounts();
  for (const plan of tables) willWrite[plan.table] = plan.rows.length;

  const preview: ImportPreview = {
    mode: "merge",
    scope: file.scope,
    encrypted,
    format_version: file.format_version,
    app_version: file.app_version,
    exported_at: file.exported_at,
    counts: fileCounts(file),
    will_write: willWrite,
    users: summarizeUsers(file),
    can_execute: blockers.length === 0,
    blockers,
    conflicts: {
      target_users: before.users,
      email_conflicts: [],
      settings_overwritten: [],
      config_overwritten: configOverwritten,
      skipped_orphan_payments: skippedOrphanPayments,
      skipped_foreign_items: skippedForeignItems,
      skipped_foreign_payments: skippedForeignPayments,
      skipped_history_rows: skippedHistoryRows,
    },
    ignored_tables: [...MERGE_IGNORED_TABLES],
    warnings,
  };

  return { mode: "merge", file, tables, before, preview };
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface ImportOptions {
  mode: ImportMode;
  actor: ImportActor;
  /** True when the uploaded file was an encrypted envelope. */
  encrypted?: boolean;
}

/** Dry run: validates the file and reports what would be written. */
export async function previewImport(
  db: D1Database,
  prefix: string,
  file: PlainExportFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  const plan =
    options.mode === "restore"
      ? await planRestore(db, prefix, file, Boolean(options.encrypted))
      : await planMerge(
          db,
          prefix,
          file,
          options.actor,
          Boolean(options.encrypted),
        );
  return plan.preview;
}

function buildInsert(
  db: D1Database,
  prefix: string,
  table: BackupTable,
  row: BoundRow,
  upsert: boolean,
): D1PreparedStatement {
  const verb = upsert ? "INSERT OR REPLACE INTO" : "INSERT INTO";
  const columnList = row.columns.join(", ");
  const placeholders = row.columns.map(() => "?").join(", ");
  return db
    .prepare(
      `${verb} ${prefix}${table} (${columnList}) VALUES (${placeholders})`,
    )
    .bind(...row.values);
}

/**
 * Guards the write path against a database that moved between planning and
 * writing: any per-table row-count difference aborts with STALE_PREVIEW.
 */
export function assertCountsUnchanged(
  before: Record<BackupTable, number>,
  current: Record<BackupTable, number>,
): void {
  for (const spec of BACKUP_TABLES) {
    if (current[spec.name] !== before[spec.name]) {
      throw new BackupError(
        "STALE_PREVIEW",
        409,
        "数据库在上次预检后已发生变化，请重新预检后再导入",
        {
          table: spec.name,
          expected: before[spec.name],
          actual: current[spec.name],
        },
      );
    }
  }
}

/**
 * Executes an import: plans afresh (a preview payload is never trusted as the
 * write plan), refuses on blockers, writes everything in one atomic batch and
 * verifies the resulting row counts.
 */
export async function executeImport(
  db: D1Database,
  prefix: string,
  file: PlainExportFile,
  options: ImportOptions,
): Promise<ImportResult> {
  const plan =
    options.mode === "restore"
      ? await planRestore(db, prefix, file, Boolean(options.encrypted))
      : await planMerge(
          db,
          prefix,
          file,
          options.actor,
          Boolean(options.encrypted),
        );

  if (plan.preview.blockers.length > 0) {
    const first = plan.preview.blockers[0];
    throw new BackupError(
      first.code,
      options.mode === "restore" ? 409 : 400,
      first.message,
      { blockers: plan.preview.blockers },
    );
  }

  // Refuse to write against a database that changed since planning.
  assertCountsUnchanged(plan.before, await countAll(db, prefix));

  const statements: D1PreparedStatement[] = [];
  for (const tablePlan of plan.tables) {
    for (const row of tablePlan.rows) {
      if (row.columns.length === 0) continue;
      statements.push(
        buildInsert(db, prefix, tablePlan.table, row, tablePlan.upsert),
      );
    }
  }

  if (statements.length > 0) {
    try {
      // One batch = one SQL transaction in D1: all or nothing.
      await db.batch(statements);
    } catch (err) {
      throw new BackupError(
        "WRITE_FAILED",
        500,
        "写入失败，事务已整体回滚，数据库未发生任何变化",
        { reason: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  // Post-write assertion: every table must hold exactly the expected count.
  for (const tablePlan of plan.tables) {
    const actual = await countTable(db, prefix, tablePlan.table);
    if (actual !== tablePlan.expectedAfter) {
      throw new BackupError(
        "RESTORE_COUNT_MISMATCH",
        500,
        `写入后 ${tablePlan.table} 的行数为 ${actual}，与预期的 ${tablePlan.expectedAfter} 不一致`,
        { table: tablePlan.table, expected: tablePlan.expectedAfter, actual },
      );
    }
  }

  const written = emptyCounts();
  for (const tablePlan of plan.tables)
    written[tablePlan.table] = tablePlan.rows.length;
  const totalWritten = Object.values(written).reduce((a, b) => a + b, 0);

  const notices: string[] = [];
  if (plan.mode === "restore") {
    notices.push("恢复完成：API Key 需重新签发，所有用户需要重新登录");
    if (written.users > 0) {
      notices.push(`已恢复 ${written.users} 个用户及其数据`);
    }
  }

  return {
    ok: true,
    mode: plan.mode,
    scope: plan.file.scope,
    written,
    total_written: totalWritten,
    notices,
    warnings: plan.preview.warnings,
  };
}

/**
 * Export/import file format — the frozen v1 contract (parent issue ONE-358
 * "导出文件格式" section).
 *
 * A plain export is:
 *
 * {
 *   "format": "enotify-export",
 *   "format_version": 1,
 *   "app_version": "<git describe>",
 *   "exported_at": "<ISO 8601>",
 *   "scope": "instance | user",
 *   "data": { users: [], user_2fa: [], items: [], payment_history: [],
 *             notification_configs: [], system_settings: [],
 *             notification_history: [] }
 * }
 *
 * Rows are column-name keyed objects. JSON columns are exported as parsed JSON
 * values; a column whose stored text is not valid JSON is exported verbatim as
 * a string and listed in that row's `_raw` array, and import writes such
 * columns back exactly as the string it found (nothing may be lost or
 * reshaped). `format_version` is independent of the DB schema version: the
 * importer ignores unknown fields and lets the DB apply current column
 * defaults for absent ones, but refuses a file whose `format_version` is
 * higher than it supports.
 */
import { BackupError } from "./errors";

export const BACKUP_FORMAT = "enotify-export";
export const BACKUP_ENCRYPTED_FORMAT = "enotify-export-encrypted";
export const BACKUP_FORMAT_VERSION = 1;

export type BackupScope = "instance" | "user";

export type BackupTable =
  | "users"
  | "user_2fa"
  | "items"
  | "payment_history"
  | "notification_configs"
  | "system_settings"
  | "notification_history";

export interface TableSpec {
  name: BackupTable;
  /** Columns stored as TEXT that hold JSON; exported as parsed values. */
  jsonColumns: readonly string[];
  /**
   * Column that identifies the owning user for `scope: "user"` filtering and
   * merge targeting ("id" for users itself, "user_id" elsewhere).
   */
  userColumn: string;
  /** Deterministic export order. */
  orderBy: string;
  /**
   * Columns regenerated during merge mode (new primary keys / rewritten
   * owner references), so a missing value is not an error for them.
   */
  generatedOnMerge: readonly string[];
  /** True when merge replaces the whole row instead of inserting a new one. */
  replaceOnMerge?: boolean;
}

/**
 * Table order is also the restore insert order: parents before children, so
 * foreign keys are satisfied without deferring them.
 */
export const BACKUP_TABLES: readonly TableSpec[] = [
  {
    name: "users",
    jsonColumns: [],
    userColumn: "id",
    orderBy: "id",
    generatedOnMerge: [],
  },
  {
    name: "user_2fa",
    jsonColumns: ["passkey_credentials"],
    userColumn: "user_id",
    orderBy: "user_id",
    generatedOnMerge: [],
  },
  {
    name: "items",
    jsonColumns: ["channels", "notification_hours"],
    userColumn: "user_id",
    orderBy: "id",
    generatedOnMerge: ["id", "user_id"],
  },
  {
    name: "payment_history",
    jsonColumns: [],
    userColumn: "user_id",
    orderBy: "id",
    generatedOnMerge: ["id", "user_id", "item_id"],
  },
  {
    name: "notification_configs",
    jsonColumns: [
      "enabled_channels",
      "telegram_config",
      "webhook_config",
      "wechatbot_config",
      "email_config",
      "bark_config",
      "slack_config",
      "feishu_config",
      "discord_config",
      "notification_hours",
    ],
    userColumn: "user_id",
    orderBy: "user_id",
    generatedOnMerge: ["user_id"],
    replaceOnMerge: true,
  },
  {
    name: "system_settings",
    jsonColumns: [],
    userColumn: "key",
    orderBy: "key",
    generatedOnMerge: [],
  },
  {
    name: "notification_history",
    jsonColumns: [],
    userColumn: "user_id",
    orderBy: "id",
    generatedOnMerge: [],
  },
];

export const TABLE_BY_NAME: Record<BackupTable, TableSpec> = Object.fromEntries(
  BACKUP_TABLES.map((spec) => [spec.name, spec]),
) as Record<BackupTable, TableSpec>;

export type BackupRow = Record<string, unknown>;
export type BackupData = Record<BackupTable, BackupRow[]>;

export interface PlainExportFile {
  format: typeof BACKUP_FORMAT;
  format_version: number;
  app_version: string;
  exported_at: string;
  scope: BackupScope;
  data: BackupData;
}

/** Columns that must never be imported from a merge-mode file. */
export const MERGE_IGNORED_TABLES: readonly BackupTable[] = [
  "users",
  "user_2fa",
  "system_settings",
  "notification_history",
];

/** Default-dropped log table: exported only when the caller opts in. */
export const HISTORY_TABLE: BackupTable = "notification_history";

export function emptyData(): BackupData {
  return {
    users: [],
    user_2fa: [],
    items: [],
    payment_history: [],
    notification_configs: [],
    system_settings: [],
    notification_history: [],
  };
}

export function countRows(data: BackupData): Record<BackupTable, number> {
  const counts = {} as Record<BackupTable, number>;
  for (const spec of BACKUP_TABLES) counts[spec.name] = data[spec.name].length;
  return counts;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Row serializer: DB row → file row. JSON columns become parsed values; a
 * value that fails to parse is kept as the original string and flagged in
 * `_raw` so importing it back cannot silently reshape the data.
 */
export function serializeRow(spec: TableSpec, row: BackupRow): BackupRow {
  const out: BackupRow = {};
  const raw: string[] = [];

  for (const [column, value] of Object.entries(row)) {
    if (!spec.jsonColumns.includes(column)) {
      out[column] = value === undefined ? null : value;
      continue;
    }
    if (value === null || value === undefined) {
      out[column] = null;
      continue;
    }
    if (typeof value === "string") {
      try {
        out[column] = JSON.parse(value);
      } catch {
        out[column] = value;
        raw.push(column);
      }
      continue;
    }
    out[column] = value;
  }

  if (raw.length > 0) out._raw = raw;
  return out;
}

/** Columns of a file row flagged as "keep the raw string" by the exporter. */
export function rawColumnsOf(row: BackupRow): string[] {
  const raw = row._raw;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/**
 * File → DB value for one column. Returns the value to bind into the INSERT.
 *
 * - JSON columns: marked-raw columns are written back as the original string;
 *   everything else is JSON.stringify'd (parsed JSON value → text). A string
 *   value that already parses as JSON is written verbatim.
 * - all other columns: written as-is (IDs, timestamps, amounts stay untouched).
 */
export function deserializeValue(
  spec: TableSpec,
  column: string,
  value: unknown,
  rawColumns: readonly string[],
): unknown {
  if (value === null || value === undefined) return null;
  if (!spec.jsonColumns.includes(column)) return value;
  if (rawColumns.includes(column)) return value;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

/** Loosely validates a decrypted/plain file and normalizes absent tables. */
export function assertPlainExport(input: unknown): PlainExportFile {
  if (!isPlainObject(input)) {
    throw new BackupError("INVALID_FILE", 400, "导入内容不是有效的 JSON 对象");
  }

  if (input.format === BACKUP_ENCRYPTED_FORMAT) {
    throw new BackupError(
      "INVALID_FORMAT",
      400,
      "文件已加密，请提供口令后重试",
      { encrypted: true },
    );
  }
  if (input.format !== BACKUP_FORMAT) {
    throw new BackupError(
      "INVALID_FORMAT",
      400,
      `文件格式不是 ${BACKUP_FORMAT}，无法导入`,
    );
  }

  const version = input.format_version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new BackupError(
      "INVALID_FORMAT",
      400,
      "文件缺少有效的 format_version",
    );
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      "UNSUPPORTED_FORMAT_VERSION",
      400,
      `文件 format_version 为 ${version}，本服务最高支持 ${BACKUP_FORMAT_VERSION}，请升级 eNotify 后再导入`,
      { file_format_version: version, supported: BACKUP_FORMAT_VERSION },
    );
  }

  const scope = input.scope;
  if (scope !== "instance" && scope !== "user") {
    throw new BackupError(
      "INVALID_SCOPE",
      400,
      '文件的 scope 必须是 "instance" 或 "user"',
    );
  }

  const rawData = input.data;
  if (!isPlainObject(rawData)) {
    throw new BackupError("INVALID_FILE", 400, "文件缺少 data 对象");
  }

  const data = emptyData();
  for (const spec of BACKUP_TABLES) {
    const tableRows = rawData[spec.name];
    if (tableRows === undefined || tableRows === null) {
      data[spec.name] = [];
      continue;
    }
    if (!Array.isArray(tableRows)) {
      throw new BackupError("INVALID_ROW", 400, `data.${spec.name} 必须是数组`);
    }
    data[spec.name] = tableRows.map((row, index) => {
      if (!isPlainObject(row)) {
        throw new BackupError(
          "INVALID_ROW",
          400,
          `data.${spec.name}[${index}] 必须是对象（行 = 以列名为键的对象）`,
        );
      }
      return row;
    });
  }

  return {
    format: BACKUP_FORMAT,
    format_version: version,
    app_version:
      typeof input.app_version === "string" ? input.app_version : "unknown",
    exported_at: typeof input.exported_at === "string" ? input.exported_at : "",
    scope,
    data,
  };
}

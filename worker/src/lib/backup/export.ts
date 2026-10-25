/**
 * Export: read the 7 tables under the resolved `{prefix}` and serialize them
 * into the frozen v1 file format.
 */
import { BackupError } from "./errors";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  emptyData,
  serializeRow,
  type BackupData,
  type BackupScope,
  type BackupTable,
  type PlainExportFile,
  TABLE_BY_NAME,
  HISTORY_TABLE,
} from "./format";

/** Declared globally by `worker/src/env.d.ts`, injected at build time. */
export function getAppVersion(): string {
  try {
    return typeof APP_VERSION !== "undefined" && APP_VERSION
      ? APP_VERSION
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface ExportOptions {
  scope: BackupScope;
  /** Required for `scope: "user"`: whose data to export. */
  userId?: string;
  /** Log table is opt-in; default drops it (data.notification_history: []). */
  includeHistory?: boolean;
}

export interface BuiltExport {
  file: PlainExportFile;
  counts: Record<BackupTable, number>;
}

async function selectRows(
  db: D1Database,
  prefix: string,
  table: BackupTable,
  userId?: string,
): Promise<Record<string, unknown>[]> {
  const spec = TABLE_BY_NAME[table];
  const tableName = `${prefix}${table}`;

  if (userId === undefined) {
    const result = await db
      .prepare(`SELECT * FROM ${tableName} ORDER BY ${spec.orderBy}`)
      .all<Record<string, unknown>>();
    return result.results ?? [];
  }

  const result = await db
    .prepare(
      `SELECT * FROM ${tableName} WHERE ${spec.userColumn} = ? ORDER BY ${spec.orderBy}`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();
  return result.results ?? [];
}

/**
 * Builds the plain (unencrypted) export file.
 *
 * `scope: "user"` keeps only the exporting user's own rows plus that one
 * `users` row; `system_settings` is always empty for that scope.
 * `scope: "instance"` dumps every row of every table.
 */
export async function buildExportFile(
  db: D1Database,
  prefix: string,
  options: ExportOptions,
): Promise<BuiltExport> {
  if (options.scope === "user" && !options.userId) {
    throw new BackupError("INVALID_REQUEST", 500, "个人档导出缺少用户标识");
  }

  const data: BackupData = emptyData();
  const counts = {} as Record<BackupTable, number>;

  for (const spec of BACKUP_TABLES) {
    const table = spec.name;

    if (table === HISTORY_TABLE && !options.includeHistory) {
      counts[table] = 0;
      continue;
    }
    if (options.scope === "user" && table === "system_settings") {
      counts[table] = 0;
      continue;
    }

    const rows = await selectRows(
      db,
      prefix,
      table,
      options.scope === "user" ? options.userId : undefined,
    );
    data[table] = rows.map((row) => serializeRow(spec, row));
    counts[table] = data[table].length;
  }

  return {
    file: {
      format: BACKUP_FORMAT,
      format_version: BACKUP_FORMAT_VERSION,
      app_version: getAppVersion(),
      exported_at: new Date().toISOString(),
      scope: options.scope,
      data,
    },
    counts,
  };
}

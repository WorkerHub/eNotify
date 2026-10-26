import {
  DEFAULT_TABLE_PREFIX,
  ensureTrailingUnderscore,
  getTablePrefix,
} from "../types";
import type { Env } from "../types";
import {
  ensureLedgerTable,
  migrationsTable,
  recordMigration,
  runLedgerMigrations,
} from "./migrations-runner";

/**
 * A migration as reported back to the admin UI. `applied`/`skipped` come from
 * the ledger runner; `stamped` only happens when a pre-ledger database is
 * verified and its history is collapsed into `schema_v1` for the first time.
 */
export type SetupMigration = {
  name: string;
  status: "applied" | "skipped" | "stamped";
};

export type SetupResult =
  | {
      success: true;
      alreadyInitialized?: true;
      effectivePrefix: string;
      migrations?: SetupMigration[];
    }
  | {
      success: false;
      code: "PREFIX_CONFLICT";
      error: string;
      message: string;
      resolvedPrefix: string;
      detectedPrefixes: string[];
    }
  | {
      success: false;
      code: "LEDGER_INCONSISTENT";
      error: string;
      message: string;
      resolvedPrefix: string;
    }
  | {
      success: false;
      code: "SCHEMA_VERIFY_FAILED";
      error: string;
      message: string;
      resolvedPrefix: string;
      missing: string[];
    };

// Unprefixed names of the tables that make up an initialized eNotify schema.
// Used to detect which prefixes the database has already been initialized
// under, so a prefix change can never silently re-initialize fresh tables.
const EONOTIFY_TABLES = [
  "users",
  "user_2fa",
  "items",
  "payment_history",
  "notification_configs",
  "system_settings",
  "notification_history",
];

/**
 * Detects the table prefixes under which an initialized eNotify schema exists.
 * A prefix counts as initialized when at least 4 core tables carrying it are
 * present and one of them is `users`. Unrelated tables (e.g. a lone `users`
 * table from another app) do not trigger a detection.
 */
export function detectTablePrefixes(tableNames: string[]): Set<string> {
  const count: Record<string, number> = {};
  const hasUsers: Record<string, boolean> = {};

  for (const t of tableNames) {
    for (const suffix of EONOTIFY_TABLES) {
      if (t === suffix) {
        count[""] = (count[""] ?? 0) + 1;
        if (suffix === "users") hasUsers[""] = true;
      } else if (t.endsWith("_" + suffix)) {
        const p = t.slice(0, t.length - suffix.length); // keeps the trailing underscore, e.g. "eNotify_"
        count[p] = (count[p] ?? 0) + 1;
        if (suffix === "users") hasUsers[p] = true;
      }
    }
  }

  return new Set(
    Object.entries(count)
      .filter(([p, n]) => n >= 4 && hasUsers[p])
      .map(([p]) => p),
  );
}

const DEFAULT_SETTINGS: Record<string, string> = {
  email_verification_enabled: "false",
  require_2fa: "false",
  registration_enabled: "true",
  smtp_config: "{}",
  resend_config: "{}",
  email_provider: "none",
  app_name: "eNotify",
};

// Channel IDs whose sender code has been removed. Their DB columns are kept
// (dropping them would require rebuilding the table) but any stale ID left in
// enabled_channels is stripped so it cannot fail every push.
const RETIRED_CHANNELS = ["serverchan", "pushplus", "gotify", "notifyx"];

// The single collapsed migration name, see `worker/src/lib/migrations.ts`.
const SCHEMA_V1_MIGRATION = "schema_v1";

// Incremental columns the legacy patch set was supposed to have produced. Used
// to verify a pre-ledger database before stamping it (see runSetup).
const LEGACY_REQUIRED_COLUMNS: Record<string, string[]> = {
  notification_history: ["body"],
  notification_configs: [
    "slack_config",
    "feishu_config",
    "discord_config",
    "default_channel",
  ],
  items: ["calendar_mode", "lunar_expiry_date"],
};

/**
 * The pre-ledger patch set, kept unchanged and now run only once, as the last
 * step before a pre-ledger database is verified and stamped. It is a
 * best-effort catch-up: it swallows its own errors (one block at a time) and
 * the shape verification afterwards is what decides whether the database may
 * be stamped. The ledger path and the fresh-install path never call it.
 */
async function runLegacyMigrations(
  db: D1Database,
  prefix: string,
): Promise<void> {
  // Migration: add body column to notification_history
  try {
    const histCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_history)`)
      .all<{ name: string }>();
    if (!histCols.results.some((c) => c.name === "body")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_history ADD COLUMN body TEXT`,
        )
        .run();
    }
  } catch {
    // ignore
  }

  // Migration: add slack_config column to notification_configs
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    if (!notifCols.results.some((c) => c.name === "slack_config")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_configs ADD COLUMN slack_config TEXT NOT NULL DEFAULT '{}'`,
        )
        .run();
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: add feishu_config / discord_config columns to notification_configs
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    for (const column of ["feishu_config", "discord_config"]) {
      if (!notifCols.results.some((c) => c.name === column)) {
        await db
          .prepare(
            `ALTER TABLE ${prefix}notification_configs ADD COLUMN ${column} TEXT NOT NULL DEFAULT '{}'`,
          )
          .run();
      }
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: add default_channel column to notification_configs. This must
  // run before the retired-channel cleanup, which reads the new column.
  try {
    const notifCols = await db
      .prepare(`PRAGMA table_info(${prefix}notification_configs)`)
      .all<{ name: string }>();
    if (!notifCols.results.some((c) => c.name === "default_channel")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}notification_configs ADD COLUMN default_channel TEXT NOT NULL DEFAULT ''`,
        )
        .run();
    }
  } catch (err) {
    console.error("Migration failed for notification_configs table:", err);
  }

  // Migration: drop retired channels (serverchan/pushplus/gotify/notifyx) from
  // enabled_channels and default_channel. Their sender code is gone, so stale
  // enabled IDs would fail and a retired default would make routing fail too.
  // Idempotent: the second run finds nothing to strip and performs no UPDATE.
  try {
    const rows = await db
      .prepare(
        `SELECT user_id, enabled_channels, default_channel FROM ${prefix}notification_configs`,
      )
      .all<{
        user_id: string;
        enabled_channels: string;
        default_channel: string;
      }>();
    for (const row of rows.results) {
      let channels: unknown;
      try {
        channels = JSON.parse(row.enabled_channels || "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(channels)) continue;
      const filtered = channels.filter((ch) => !RETIRED_CHANNELS.includes(ch));
      const defaultChannel = RETIRED_CHANNELS.includes(row.default_channel)
        ? ""
        : row.default_channel;
      if (
        filtered.length === channels.length &&
        defaultChannel === row.default_channel
      ) {
        continue;
      }
      await db
        .prepare(
          `UPDATE ${prefix}notification_configs SET enabled_channels = ?, default_channel = ? WHERE user_id = ?`,
        )
        .bind(JSON.stringify(filtered), defaultChannel, row.user_id)
        .run();
    }
  } catch (err) {
    console.error("Migration failed to drop retired channels:", err);
  }

  // Migration: items table columns (type/use_lunar -> calendar_mode, lunar_expiry_date).
  // Uses ALTER TABLE instead of recreating the table: DROP TABLE would cascade-delete payment_history.
  try {
    const colCheck = await db
      .prepare(`PRAGMA table_info(${prefix}items)`)
      .all<{ name: string }>();
    const cols = new Set(colCheck.results.map((c) => c.name));

    if (!cols.has("calendar_mode")) {
      await db
        .prepare(
          `ALTER TABLE ${prefix}items ADD COLUMN calendar_mode TEXT NOT NULL DEFAULT 'solar'`,
        )
        .run();
      if (cols.has("use_lunar")) {
        await db
          .prepare(
            `UPDATE ${prefix}items SET calendar_mode = CASE WHEN use_lunar = 1 THEN 'lunar' ELSE 'solar' END`,
          )
          .run();
      }
    }
    if (!cols.has("lunar_expiry_date")) {
      await db
        .prepare(`ALTER TABLE ${prefix}items ADD COLUMN lunar_expiry_date TEXT`)
        .run();
    }
    if (cols.has("use_lunar")) {
      await db
        .prepare(`ALTER TABLE ${prefix}items DROP COLUMN use_lunar`)
        .run();
    }
    if (cols.has("type")) {
      await db.prepare(`ALTER TABLE ${prefix}items DROP COLUMN type`).run();
    }
  } catch (err) {
    console.error("Migration failed for items table:", err);
  }
}

/**
 * Initialize or upgrade the database under the resolved table prefix.
 *
 * The prefix-conflict guard runs first and never touches a database that
 * belongs to another prefix. After it, the state of the resolved prefix
 * decides what happens:
 *
 * 1. the migration ledger exists → apply whatever it does not record yet (and
 *    refuse a ledger that describes tables which are gone);
 * 2. no ledger but business tables → pre-ledger database: run the legacy patch
 *    set one last time, verify the resulting shape, then stamp `schema_v1`;
 * 3. neither → fresh install through the ledger, then seed the default
 *    settings.
 *
 * A failing migration propagates as an error (setup reports a failure instead
 * of pretending it succeeded); the recorded migrations make it resumable.
 */
export async function runSetup(env: Env): Promise<SetupResult> {
  const prefix = getTablePrefix(env);
  const db = env.DB;

  // Anti-silent-switch guard: if the database already holds an initialized
  // eNotify schema under a different prefix, abort instead of re-initializing
  // fresh tables under the resolved prefix.
  const rows = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all<{ name: string }>();
  const detected = detectTablePrefixes(rows.results.map((r) => r.name));

  if (!detected.has(prefix) && detected.size > 0) {
    const detectedList = [...detected].sort();
    let message: string;
    if (
      detected.has("") &&
      prefix === ensureTrailingUnderscore(DEFAULT_TABLE_PREFIX)
    ) {
      message =
        `Detected a legacy schema without table prefix, but TABLE_PREFIX is unset ` +
        `(resolves to "${prefix}"). To keep the legacy tables, set TABLE_PREFIX to an ` +
        `explicit empty value (GitHub vars: TABLE_PREFIX=none, injected as "" by CI), ` +
        `or migrate the tables to the "${prefix}" prefix per the README upgrade guide.`;
    } else {
      message =
        `TABLE_PREFIX mismatch: this database is already initialized under a different ` +
        `table prefix (detected: ${detectedList.join(", ")}), but TABLE_PREFIX resolves ` +
        `to "${prefix}". Set TABLE_PREFIX explicitly to keep the existing tables ` +
        `(e.g. "${detectedList[0]}"), or migrate the tables to the new prefix before ` +
        `retrying setup.`;
    }

    return {
      success: false,
      code: "PREFIX_CONFLICT",
      error: message,
      message,
      resolvedPrefix: prefix,
      detectedPrefixes: detectedList,
    };
  }

  // State machine, resolved prefix, after the guard above:
  //   1. ledger exists              → run whatever is not recorded yet
  //   2. no ledger, business tables → in-place transition: legacy patches →
  //                                   shape verification → stamp
  //   3. no ledger, no tables       → fresh install through the ledger
  const ledger = migrationsTable(prefix);
  const ledgerExists = await tableExists(db, ledger);
  const hasBusinessTables = await tableExists(db, `${prefix}users`);

  if (ledgerExists) {
    // A ledger that records migrations while the tables it describes are gone
    // is inconsistent: never silently re-run the runner over that database.
    const recorded = await db
      .prepare(`SELECT name FROM ${ledger}`)
      .all<{ name: string }>();
    if (recorded.results.length > 0 && !hasBusinessTables) {
      const error =
        `Migration ledger "${ledger}" records applied migrations, but the business ` +
        `tables ("${prefix}users") are missing. If the tables were deleted on ` +
        `purpose, drop the ledger table as well and run setup again; otherwise ` +
        `restore the tables.`;
      return {
        success: false,
        code: "LEDGER_INCONSISTENT",
        error,
        message: error,
        resolvedPrefix: prefix,
      };
    }

    // Recorded migrations are skipped; anything unrecorded (including a ledger
    // that is still empty after an interrupted run) is applied now.
    const migrations = await runLedgerMigrations(db, prefix);
    return {
      success: true,
      alreadyInitialized: true,
      effectivePrefix: prefix,
      migrations,
    };
  }

  if (hasBusinessTables) {
    // Pre-ledger database: it may sit at any historical migration state, so it
    // must not be stamped blindly. Catch it up, verify the shape, then stamp.
    await runLegacyMigrations(db, prefix);

    const missing = await verifyLegacyShape(db, prefix);
    if (missing.length > 0) {
      const error =
        `Existing database is missing schema the legacy patch set should have ` +
        `provided: ${missing.join(", ")}. The migration ledger was not stamped; ` +
        `fix the database and run setup again.`;
      return {
        success: false,
        code: "SCHEMA_VERIFY_FAILED",
        error,
        message: error,
        resolvedPrefix: prefix,
        missing,
      };
    }

    await ensureLedgerTable(db, prefix);
    await recordMigration(db, prefix, SCHEMA_V1_MIGRATION);
    return {
      success: true,
      alreadyInitialized: true,
      effectivePrefix: prefix,
      migrations: [{ name: SCHEMA_V1_MIGRATION, status: "stamped" }],
    };
  }

  const migrations = await runLedgerMigrations(db, prefix);
  await seedDefaultSettings(db, prefix);

  return { success: true, effectivePrefix: prefix, migrations };
}

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .bind(name)
    .first();
  return row !== null;
}

/**
 * Verify that a pre-ledger database really carries everything the legacy patch
 * set promised, before its history is collapsed to schema_v1. Returns the list
 * of missing tables/columns (empty when the shape is complete).
 */
async function verifyLegacyShape(
  db: D1Database,
  prefix: string,
): Promise<string[]> {
  const missing: string[] = [];

  for (const table of EONOTIFY_TABLES) {
    const full = `${prefix}${table}`;
    if (!(await tableExists(db, full))) {
      missing.push(`table ${full}`);
      continue;
    }

    const required = LEGACY_REQUIRED_COLUMNS[table] ?? [];
    if (required.length === 0) continue;

    const columns = await db
      .prepare(`PRAGMA table_info(${full})`)
      .all<{ name: string }>();
    const present = new Set(columns.results.map((c) => c.name));
    for (const column of required) {
      if (!present.has(column)) missing.push(`column ${full}.${column}`);
    }
  }

  return missing;
}

async function seedDefaultSettings(
  db: D1Database,
  prefix: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ${prefix}system_settings (key, value, updated_at) VALUES (?, ?, ?)`,
      )
      .bind(key, value, now)
      .run();
  }
}

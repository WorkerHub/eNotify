import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMigrations } from "../src/lib/migrations";
import { migrationsTable } from "../src/lib/migrations-runner";
import { runSetup } from "../src/lib/setup";
import type { Env } from "../src/types";
import { SqliteD1 } from "./support/sqlite-d1";

/**
 * Migration ledger acceptance tests (spec §5): fresh install, structure parity
 * with the pre-ledger schema, in-place transition of legacy databases, prefix
 * variants and the prefix-conflict / foreign-ledger guard.
 */

type Row = Record<string, unknown>;

const LEDGER_SUFFIX = "_schema_migrations";

function makeEnv(d1: SqliteD1, tablePrefix?: string): Env {
  const env: Record<string, unknown> = { DB: d1 };
  if (tablePrefix !== undefined) env.TABLE_PREFIX = tablePrefix;
  return env as unknown as Env;
}

function execSQL(d1: SqliteD1, sql: string): void {
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)) {
    d1.db.exec(statement);
  }
}

function tableNames(d1: SqliteD1): string[] {
  return (
    d1.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function columnsOf(d1: SqliteD1, table: string): ColumnInfo[] {
  return d1.db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function indexesOf(d1: SqliteD1, table: string) {
  return d1.db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = ? AND tbl_name = ? ORDER BY name`,
    )
    .all("index", table) as { name: string; sql: string | null }[];
}

function rowsOf(d1: SqliteD1, table: string, orderBy = "rowid"): Row[] {
  return d1.db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as
    | Row[]
    | never;
}

function ledgerRows(d1: SqliteD1, ledger: string): Row[] {
  return d1.db
    .prepare(`SELECT name FROM ${ledger} ORDER BY name`)
    .all() as Row[];
}

function exists(d1: SqliteD1, name: string): boolean {
  return (
    d1.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) !== undefined
  );
}

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/** Structural + data snapshot of a whole database, for "nothing changed" assertions. */
function snapshot(d1: SqliteD1): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  for (const table of tableNames(d1)) {
    snap[table] = {
      columns: columnsOf(d1, table),
      indexes: indexesOf(d1, table),
      rows: rowsOf(d1, table),
    };
  }
  return snap;
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

/** `worker/src/db/schema.sql` is the current, fully patched shape (no ledger). */
const CURRENT_SCHEMA = readFileSync(
  new URL("../src/db/schema.sql", import.meta.url),
  "utf8",
);

/** Build an up-to-date eNotify database without a migration ledger. */
function seedCurrentShape(d1: SqliteD1, prefix = ""): void {
  execSQL(d1, CURRENT_SCHEMA.replace(/\{prefix\}/g, prefix));
}

/** Apply only `schema_v1`, for parity checks against the pre-ledger fixture. */
function seedSchemaV1(d1: SqliteD1, prefix = ""): void {
  const migration = getMigrations(prefix).find((m) => m.name === "schema_v1");
  if (!migration) throw new Error("schema_v1 migration missing");
  execSQL(d1, migration.sql);
}

/**
 * The oldest shape the legacy patch set still has to fix: no
 * notification_history.body, no slack/feishu/discord/default_channel columns,
 * no calendar_mode/lunar_expiry_date (items still carries type/use_lunar), and
 * channel configs still listing the retired channels.
 */
const OLDEST_SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  email_verified INTEGER NOT NULL DEFAULT 0,
  base_currency TEXT NOT NULL DEFAULT 'CNY',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  language TEXT NOT NULL DEFAULT 'zh',
  theme TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_2fa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  passkey_credentials TEXT,
  passkey_enabled INTEGER NOT NULL DEFAULT 0,
  email_otp_enabled INTEGER NOT NULL DEFAULT 0,
  preferred_method TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  item_mode TEXT NOT NULL DEFAULT 'cycle',
  type TEXT NOT NULL DEFAULT 'subscription',
  use_lunar INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  expiry_date TEXT NOT NULL,
  period_value INTEGER NOT NULL DEFAULT 1,
  period_unit TEXT NOT NULL DEFAULT 'month',
  reminder_unit TEXT NOT NULL DEFAULT 'day',
  reminder_value INTEGER NOT NULL DEFAULT 7,
  notes TEXT NOT NULL DEFAULT '',
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  last_payment_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  channels TEXT NOT NULL DEFAULT '[]',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  item_kind TEXT NOT NULL DEFAULT 'regular',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_items_user_id ON items(user_id);

CREATE TABLE payment_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  type TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_payment_history_item_id ON payment_history(item_id);
CREATE INDEX idx_payment_history_user_id ON payment_history(user_id);

CREATE TABLE notification_configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled_channels TEXT NOT NULL DEFAULT '[]',
  telegram_config TEXT NOT NULL DEFAULT '{}',
  webhook_config TEXT NOT NULL DEFAULT '{}',
  wechatbot_config TEXT NOT NULL DEFAULT '{}',
  email_config TEXT NOT NULL DEFAULT '{}',
  bark_config TEXT NOT NULL DEFAULT '{}',
  gotify_config TEXT NOT NULL DEFAULT '{}',
  serverchan_config TEXT NOT NULL DEFAULT '{}',
  pushplus_config TEXT NOT NULL DEFAULT '{}',
  notifyx_config TEXT NOT NULL DEFAULT '{}',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notification_history_user_id
  ON notification_history(user_id, created_at);
`;

function seedOldestShape(d1: SqliteD1): void {
  execSQL(d1, OLDEST_SCHEMA);
  execSQL(
    d1,
    `
INSERT INTO users (id, email, password_hash, role, is_active, email_verified,
  base_currency, timezone, language, theme, created_at, updated_at)
VALUES
  ('u1', 'u1@example.com', 'hash-1', 'admin', 1, 1, 'CNY', 'Asia/Shanghai', 'zh', 'dark', '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z'),
  ('u2', 'u2@example.com', 'hash-2', 'user', 1, 0, 'USD', 'UTC', 'en', 'light', '2025-02-01T00:00:00.000Z', '2025-02-02T00:00:00.000Z');

INSERT INTO user_2fa (user_id, totp_secret, totp_enabled, passkey_credentials, passkey_enabled, email_otp_enabled, preferred_method, updated_at)
VALUES ('u1', 'JBSWY3DPEHPK3PXP', 1, NULL, 0, 0, 'totp', '2025-01-03T00:00:00.000Z');

INSERT INTO items (id, user_id, name, item_mode, type, use_lunar, category, expiry_date, period_value, period_unit, reminder_unit, reminder_value, notes, amount, currency, is_active, auto_renew, channels, notification_hours, item_kind, created_at, updated_at)
VALUES
  ('i1', 'u1', 'Lunar Plan', 'cycle', 'subscription', 1, 'work', '2025-03-01', 1, 'month', 'day', 7, 'note-1', 12.5, 'CNY', 1, 1, '["telegram"]', '[8,9]', 'subscription', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('i2', 'u2', 'Solar Plan', 'reset', 'regular', 0, '', '2025-04-01', 2, 'week', 'hour', 3, '', NULL, 'USD', 0, 1, '[]', '[]', 'regular', '2025-02-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z');

INSERT INTO payment_history (id, item_id, user_id, date, amount, currency, type, note, period_start, period_end, created_at)
VALUES ('p1', 'i1', 'u1', '2025-01-01', 12.5, 'CNY', 'initial', 'first', '2025-01-01', '2025-02-01', '2025-01-01T00:00:00.000Z');

INSERT INTO notification_configs (user_id, enabled_channels, telegram_config, gotify_config, notification_hours, updated_at)
VALUES ('u1', '["telegram","serverchan","pushplus","gotify","notifyx"]', '{"bot_token":"secret","chat_id":"42"}', '{"server_url":"https://gotify.example.com","app_token":"tok"}', '[8,9]', '2025-01-04T00:00:00.000Z');

INSERT INTO system_settings (key, value, updated_at)
VALUES ('app_name', 'eNotify', '2025-01-01T00:00:00.000Z');

INSERT INTO notification_history (id, user_id, item_id, channel, title, success, error, created_at)
VALUES ('h1', 'u1', 'i1', 'telegram', 'Renewal due', 1, NULL, '2025-01-05T00:00:00.000Z');
`,
  );
}

// ─── ledger naming ────────────────────────────────────────────────────────────

describe("migrationsTable name formula", () => {
  it("uses the prefix core with the trailing underscore stripped", () => {
    expect(migrationsTable("enotify_")).toBe("_enotify_schema_migrations");
    expect(migrationsTable("eNotify_")).toBe("_eNotify_schema_migrations");
    expect(migrationsTable("X")).toBe("_X_schema_migrations");
    expect(migrationsTable("X_")).toBe("_X_schema_migrations");
  });

  it("has no prefix core when there is no table prefix", () => {
    expect(migrationsTable("")).toBe("_schema_migrations");
  });
});

describe("migration list", () => {
  it("keeps schema_v1 as the base and appends schema_v2 / schema_v3", () => {
    const migrations = getMigrations("enotify_");
    expect(migrations.map((m) => m.name)).toEqual([
      "schema_v1",
      "schema_v2",
      "schema_v3",
    ]);
    // `{prefix}` is resolved for the caller, the DDL itself carries no placeholder.
    expect(migrations[0].sql).toContain(
      "CREATE TABLE IF NOT EXISTS enotify_users",
    );
    expect(migrations[0].sql).not.toContain("{prefix}");
    expect(migrations[1].sql).toContain(
      "ALTER TABLE enotify_notification_history ADD COLUMN trigger_source TEXT",
    );
    expect(migrations[1].sql).not.toContain("{prefix}");
    expect(migrations[2].sql).toContain(
      "CREATE TABLE IF NOT EXISTS enotify_waker_executions",
    );
    expect(migrations[2].sql).toContain(
      "CREATE TABLE IF NOT EXISTS enotify_scheduler_tick_claims",
    );
    expect(migrations[2].sql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_enotify_scheduler_tick_claims_claimed_at",
    );
    expect(migrations[2].sql).not.toContain("{prefix}");
  });

  it("migration SQL contains no ';' inside string literals", () => {
    for (const migration of getMigrations("")) {
      for (const statement of migration.sql.split(";")) {
        const literals = statement.match(/'[^']*'/g) ?? [];
        for (const literal of literals) {
          expect(literal).not.toContain(";");
        }
      }
    }
  });
});

// ─── fresh install ────────────────────────────────────────────────────────────

describe("fresh install through the ledger", () => {
  it("creates the 7 business tables, the 2 waker tables, the ledger and the default settings", async () => {
    const d1 = new SqliteD1();

    const result = await runSetup(makeEnv(d1, "enotify"));

    expect(result).toEqual({
      success: true,
      effectivePrefix: "enotify_",
      migrations: [
        { name: "schema_v1", status: "applied" },
        { name: "schema_v2", status: "applied" },
        { name: "schema_v3", status: "applied" },
      ],
    });

    const tables = tableNames(d1);
    for (const table of [
      "users",
      "user_2fa",
      "items",
      "payment_history",
      "notification_configs",
      "system_settings",
      "notification_history",
      "waker_executions",
      "scheduler_tick_claims",
    ]) {
      expect(tables).toContain(`enotify_${table}`);
    }
    expect(tables).toContain("_enotify_schema_migrations");
    expect(ledgerRows(d1, "_enotify_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
    expect(
      indexesOf(d1, "enotify_scheduler_tick_claims").map((i) => i.name),
    ).toContain("idx_enotify_scheduler_tick_claims_claimed_at");
    expect(
      columnsOf(d1, "enotify_waker_executions").map((c) => c.name),
    ).toEqual([
      "execution_id",
      "job_id",
      "job_name",
      "scheduled_for",
      "status",
      "response_json",
      "claimed_at",
      "completed_at",
    ]);
    expect(
      columnsOf(d1, "enotify_notification_history").map((c) => c.name),
    ).toContain("trigger_source");
    expect(
      indexesOf(d1, "enotify_notification_history").map((i) => i.name),
    ).toContain("idx_enotify_notification_history_filter");

    const settings = rowsOf(d1, "enotify_system_settings", "key").map(
      (r) => r.key,
    );
    expect(settings).toEqual([
      "app_name",
      "email_provider",
      "email_verification_enabled",
      "registration_enabled",
      "require_2fa",
      "resend_config",
      "smtp_config",
    ]);
  });

  it("skips everything on the second run and leaves structure and data untouched", async () => {
    const d1 = new SqliteD1();
    await runSetup(makeEnv(d1, "enotify_"));

    const before = snapshot(d1);
    const second = await runSetup(makeEnv(d1, "enotify_"));

    expect(second).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "enotify_",
      migrations: [
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "skipped" },
        { name: "schema_v3", status: "skipped" },
      ],
    });
    expect(snapshot(d1)).toEqual(before);
  });
});

// ─── structure parity with the pre-ledger schema (core acceptance) ────────────

describe("schema_v1 structure parity with the pre-ledger install", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/schema-before-ledger.json", import.meta.url),
      "utf8",
    ),
  ) as {
    prefix: string;
    tables: {
      name: string;
      table_info: ColumnInfo[];
      indexes: { name: string; sql: string | null }[];
    }[];
  };

  it("matches the pre-ledger snapshot table by table (PRAGMA table_info + indexes)", async () => {
    const d1 = new SqliteD1();
    seedSchemaV1(d1);

    // Only the ledger table is new; every pre-existing table is described below.
    const businessTables = tableNames(d1).filter(
      (t) => !t.endsWith(LEDGER_SUFFIX),
    );
    expect(businessTables).toEqual(fixture.tables.map((t) => t.name).sort());

    for (const expected of fixture.tables) {
      expect({
        name: expected.name,
        table_info: columnsOf(d1, expected.name).map(
          ({ cid: _cid, ...column }) => column,
        ),
        indexes: indexesOf(d1, expected.name).filter(
          (index) => index.sql !== null,
        ),
      }).toEqual(expected);
    }
  });

  it("keeps the structure of a pre-ledger database after the in-place transition", async () => {
    const d1 = new SqliteD1();
    seedSchemaV1(d1);

    // Same 7 tables, same columns/indexes as the legacy patch set produced.
    for (const expected of fixture.tables) {
      expect(
        columnsOf(d1, expected.name).map(({ cid: _cid, ...column }) => column),
      ).toEqual(expected.table_info);
      expect(
        indexesOf(d1, expected.name).filter((index) => index.sql !== null),
      ).toEqual(expected.indexes);
    }
  });
});

// ─── legacy in-place transition ──────────────────────────────────────────────

describe("legacy database transition", () => {
  it("patches the oldest shape, verifies it and stamps schema_v1 without touching rows", async () => {
    const d1 = new SqliteD1();
    seedOldestShape(d1);

    const beforeUsers = rowsOf(d1, "users");
    const beforePayments = rowsOf(d1, "payment_history");
    const beforeHistory = rowsOf(d1, "notification_history");
    const beforeSettings = rowsOf(d1, "system_settings");
    const beforeItems = rowsOf(d1, "items");
    const beforeConfigs = rowsOf(d1, "notification_configs");

    const result = await runSetup(makeEnv(d1, ""));

    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
    expect(ledgerRows(d1, "_schema_migrations")).toEqual([
      { name: "schema_v1" },
    ]);

    // Incremental columns are in place.
    const historyCols = columnsOf(d1, "notification_history").map(
      (c) => c.name,
    );
    expect(historyCols).toContain("body");
    const configCols = columnsOf(d1, "notification_configs").map((c) => c.name);
    for (const column of [
      "slack_config",
      "feishu_config",
      "discord_config",
      "default_channel",
    ]) {
      expect(configCols).toContain(column);
    }
    const itemCols = columnsOf(d1, "items").map((c) => c.name);
    expect(itemCols).toContain("calendar_mode");
    expect(itemCols).toContain("lunar_expiry_date");
    // The legacy patch set's own DROP COLUMN steps still run.
    expect(itemCols).not.toContain("use_lunar");
    expect(itemCols).not.toContain("type");

    // Existing rows are untouched, one by one.
    expect(rowsOf(d1, "users")).toEqual(beforeUsers);
    expect(rowsOf(d1, "payment_history")).toEqual(beforePayments);
    expect(rowsOf(d1, "system_settings")).toEqual(beforeSettings);
    expect(rowsOf(d1, "notification_history")).toEqual(
      beforeHistory.map((row) => ({ ...row, body: null })),
    );

    // items keeps every surviving column, and calendar_mode is backfilled from use_lunar.
    expect(
      rowsOf(d1, "items").map(
        ({ calendar_mode, lunar_expiry_date, ...rest }) => ({
          ...rest,
          calendar_mode,
        }),
      ),
    ).toEqual(
      beforeItems.map(({ type, use_lunar, ...rest }) => ({
        ...rest,
        calendar_mode: use_lunar === 1 ? "lunar" : "solar",
      })),
    );

    // Retired channel IDs are stripped, everything else stays; default_channel
    // is the new empty default (spec §2.5 behaviour parity).
    expect(rowsOf(d1, "notification_configs")).toEqual(
      beforeConfigs.map((row) => ({
        ...row,
        enabled_channels: '["telegram"]',
        default_channel: "",
        slack_config: "{}",
        feishu_config: "{}",
        discord_config: "{}",
      })),
    );
  });

  it("stamps an already up-to-date database, applies pending migrations, then no-ops", async () => {
    const d1 = new SqliteD1();
    seedCurrentShape(d1);
    execSQL(
      d1,
      `INSERT INTO users (id, email, password_hash, created_at, updated_at)
       VALUES ('u1', 'u1@example.com', 'hash', '2025-01-01', '2025-01-01');
       INSERT INTO notification_configs (user_id, enabled_channels, default_channel, updated_at)
       VALUES ('u1', '["telegram"]', 'telegram', '2025-01-01');`,
    );

    const before = {
      users: rowsOf(d1, "users"),
      configs: rowsOf(d1, "notification_configs"),
    };

    const first = await runSetup(makeEnv(d1, ""));
    expect(first).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
    expect(rowsOf(d1, "users")).toEqual(before.users);
    expect(rowsOf(d1, "notification_configs")).toEqual(before.configs);

    const second = await runSetup(makeEnv(d1, ""));
    expect(second).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "applied" },
        { name: "schema_v3", status: "applied" },
      ],
    });

    const afterSecond = snapshot(d1);
    const third = await runSetup(makeEnv(d1, ""));
    expect(third).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "skipped" },
        { name: "schema_v3", status: "skipped" },
      ],
    });
    expect(snapshot(d1)).toEqual(afterSecond);
  });

  it("clears retired channel IDs during the transition (same behaviour as before)", async () => {
    const d1 = new SqliteD1();
    seedOldestShape(d1);

    await runSetup(makeEnv(d1, ""));

    expect(
      d1.db.prepare(`SELECT enabled_channels FROM notification_configs`).all(),
    ).toEqual([{ enabled_channels: '["telegram"]' }]);
  });

  describe("shape verification failure", () => {
    it("refuses to stamp when a business table is missing", async () => {
      const d1 = new SqliteD1();
      seedCurrentShape(d1);
      d1.db.exec("DROP TABLE notification_history");

      const result = await runSetup(makeEnv(d1, ""));

      expect(result).toMatchObject({
        success: false,
        code: "SCHEMA_VERIFY_FAILED",
        resolvedPrefix: "",
        missing: ["table notification_history"],
      });
      if (!result.success && result.code === "SCHEMA_VERIFY_FAILED") {
        expect(result.error).toContain("notification_history");
        expect(result.error).toContain("was not stamped");
      }
      // No ledger was created, so the admin can fix the database and retry.
      expect(exists(d1, "_schema_migrations")).toBe(false);
    });

    it("refuses to stamp when a required column cannot be added", async () => {
      const d1 = new SqliteD1();
      seedCurrentShape(d1);
      // A mis-cased column name: SQLite treats column names case-insensitively,
      // so the legacy `ADD COLUMN default_channel` fails as a duplicate while the
      // verification (which checks the exact name) still sees the gap.
      d1.db.exec(
        "ALTER TABLE notification_configs RENAME COLUMN default_channel TO Default_Channel",
      );

      const result = await runSetup(makeEnv(d1, ""));

      expect(result).toMatchObject({
        success: false,
        code: "SCHEMA_VERIFY_FAILED",
        missing: ["column notification_configs.default_channel"],
      });
      expect(exists(d1, "_schema_migrations")).toBe(false);
    });
  });

  it("re-runs the transition after the database is repaired", async () => {
    const d1 = new SqliteD1();
    seedCurrentShape(d1);
    d1.db.exec("DROP TABLE notification_history");

    const failed = await runSetup(makeEnv(d1, ""));
    expect(failed.success).toBe(false);

    execSQL(
      d1,
      `CREATE TABLE notification_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT,
        channel TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at TEXT NOT NULL
      );`,
    );

    const repaired = await runSetup(makeEnv(d1, ""));
    expect(repaired).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
  });
});

// ─── ledger consistency ──────────────────────────────────────────────────────

describe("ledger consistency check", () => {
  it("fails when the ledger records migrations but the business tables are gone", async () => {
    const d1 = new SqliteD1();
    await runSetup(makeEnv(d1, ""));

    d1.db.exec("DROP TABLE users");

    const result = await runSetup(makeEnv(d1, ""));

    expect(result).toMatchObject({
      success: false,
      code: "LEDGER_INCONSISTENT",
      resolvedPrefix: "",
    });
    if (!result.success && result.code === "LEDGER_INCONSISTENT") {
      expect(result.error).toContain("_schema_migrations");
      expect(result.error).toContain("drop the ledger table");
    }
    // Nothing was recreated behind the admin's back.
    expect(exists(d1, "users")).toBe(false);
  });

  it("completes a run that was interrupted between ledger creation and recording", async () => {
    const d1 = new SqliteD1();
    // Ledger table exists but is empty, as after a crash before the first INSERT.
    d1.db.exec(
      "CREATE TABLE _schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))",
    );

    const result = await runSetup(makeEnv(d1, ""));

    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "applied" },
        { name: "schema_v2", status: "applied" },
        { name: "schema_v3", status: "applied" },
      ],
    });
    expect(ledgerRows(d1, "_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
    expect(exists(d1, "users")).toBe(true);
  });
});

// ─── prefix variants ────────────────────────────────────────────────────────

describe("prefix variants", () => {
  it("defaults to _enotify_schema_migrations", async () => {
    const d1 = new SqliteD1();
    // TABLE_PREFIX unset → default "enotify" → "enotify_".
    await runSetup(makeEnv(d1));

    expect(exists(d1, "_enotify_schema_migrations")).toBe(true);
    expect(ledgerRows(d1, "_enotify_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
    expect(exists(d1, "enotify_users")).toBe(true);
    expect(exists(d1, "enotify_waker_executions")).toBe(true);
    expect(exists(d1, "enotify_scheduler_tick_claims")).toBe(true);
  });

  it("uses _schema_migrations for an explicit empty prefix", async () => {
    const d1 = new SqliteD1();
    await runSetup(makeEnv(d1, ""));

    expect(exists(d1, "_schema_migrations")).toBe(true);
    expect(ledgerRows(d1, "_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
    expect(exists(d1, "users")).toBe(true);
    expect(exists(d1, "waker_executions")).toBe(true);
    expect(exists(d1, "scheduler_tick_claims")).toBe(true);
  });

  it("uses _X_schema_migrations for a custom prefix X", async () => {
    const d1 = new SqliteD1();
    await runSetup(makeEnv(d1, "X"));

    expect(exists(d1, "_X_schema_migrations")).toBe(true);
    expect(ledgerRows(d1, "_X_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
    expect(exists(d1, "X_users")).toBe(true);
    expect(exists(d1, "X_waker_executions")).toBe(true);
    expect(exists(d1, "X_scheduler_tick_claims")).toBe(true);
  });

  it("leaves another prefix's tables and ledger untouched when two coexist", async () => {
    const d1 = new SqliteD1();
    // Two instances that were both set up earlier under their own prefix.
    seedCurrentShape(d1, "tenant_a_");
    seedCurrentShape(d1, "tenant_b_");
    d1.db.exec(
      `CREATE TABLE _tenant_a_schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()));
       INSERT INTO _tenant_a_schema_migrations (name) VALUES ('schema_v1');
       INSERT INTO tenant_a_users (id, email, password_hash, created_at, updated_at)
         VALUES ('a1', 'a@example.com', 'hash', '2025-01-01', '2025-01-01');`,
    );

    const result = await runSetup(makeEnv(d1, "tenant_b_"));

    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "tenant_b_",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
    // tenant_a is untouched (ledger row count unchanged, its data still there).
    expect(ledgerRows(d1, "_tenant_a_schema_migrations")).toEqual([
      { name: "schema_v1" },
    ]);
    expect(rowsOf(d1, "tenant_a_users")).toHaveLength(1);
    // tenant_b got its own record.
    expect(ledgerRows(d1, "_tenant_b_schema_migrations")).toEqual([
      { name: "schema_v1" },
    ]);
  });
});

// ─── guard regressions ──────────────────────────────────────────────────────

describe("prefix conflict guard with the ledger", () => {
  it("still returns PREFIX_CONFLICT and creates no ledger table", async () => {
    const d1 = new SqliteD1();
    seedCurrentShape(d1, "other_");

    const result = await runSetup(makeEnv(d1, "enotify"));

    expect(result).toMatchObject({
      success: false,
      code: "PREFIX_CONFLICT",
      resolvedPrefix: "enotify_",
      detectedPrefixes: ["other_"],
    });
    expect(tableNames(d1).filter((t) => t.endsWith(LEDGER_SUFFIX))).toEqual([]);
    expect(exists(d1, "enotify_users")).toBe(false);
  });

  it("ignores another project's ledger table on a fresh install", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(
      "CREATE TABLE _ZETA_schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))",
    );

    const result = await runSetup(makeEnv(d1, "enotify"));

    expect(result).toEqual({
      success: true,
      effectivePrefix: "enotify_",
      migrations: [
        { name: "schema_v1", status: "applied" },
        { name: "schema_v2", status: "applied" },
        { name: "schema_v3", status: "applied" },
      ],
    });
    // The foreign ledger is neither read nor written.
    expect(ledgerRows(d1, "_ZETA_schema_migrations")).toEqual([]);
    expect(ledgerRows(d1, "_enotify_schema_migrations")).toEqual([
      { name: "schema_v1" },
      { name: "schema_v2" },
      { name: "schema_v3" },
    ]);
  });

  it("does not let another project's ledger interfere with a legacy transition", async () => {
    const d1 = new SqliteD1();
    seedCurrentShape(d1, "enotify_");
    d1.db.exec(
      "CREATE TABLE _ZETA_schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))",
    );

    const result = await runSetup(makeEnv(d1, "enotify"));

    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "enotify_",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
    expect(ledgerRows(d1, "_ZETA_schema_migrations")).toEqual([]);
    expect(ledgerRows(d1, "_enotify_schema_migrations")).toEqual([
      { name: "schema_v1" },
    ]);
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runSetup } from "../src/lib/setup";
import type { Env } from "../src/types";

/**
 * Minimal D1 stand-in backed by a real in-memory SQLite database. Unlike the
 * MockD1 in helpers.ts this keeps real column defaults and row data, which is
 * what the slack_config migration needs to be verified against.
 */
class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");

  prepare(sql: string): any {
    const db = this.db;
    const statement = () => db.prepare(sql);

    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() =>
          (statement().get(...(args as any[])) ?? null) as T | null,
        all: async <T>() => ({
          results: statement().all(...(args as any[])) as T[],
        }),
        run: async () => {
          statement().run(...(args as any[]));
          return { success: true };
        },
      }),
      first: async <T>() => (statement().get() ?? null) as T | null,
      all: async <T>() => ({ results: statement().all() as T[] }),
      run: async () => {
        statement().run();
        return { success: true };
      },
    };
  }
}

const PREFIX = "en_";

// Schema as deployed before the Slack channel existed: no slack_config column.
const OLD_SCHEMA = `
CREATE TABLE ${PREFIX}users (
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

CREATE TABLE ${PREFIX}notification_configs (
  user_id           TEXT PRIMARY KEY REFERENCES ${PREFIX}users(id) ON DELETE CASCADE,
  enabled_channels  TEXT NOT NULL DEFAULT '[]',
  telegram_config   TEXT NOT NULL DEFAULT '{}',
  webhook_config    TEXT NOT NULL DEFAULT '{}',
  wechatbot_config  TEXT NOT NULL DEFAULT '{}',
  email_config      TEXT NOT NULL DEFAULT '{}',
  bark_config       TEXT NOT NULL DEFAULT '{}',
  gotify_config     TEXT NOT NULL DEFAULT '{}',
  serverchan_config TEXT NOT NULL DEFAULT '{}',
  pushplus_config   TEXT NOT NULL DEFAULT '{}',
  notifyx_config    TEXT NOT NULL DEFAULT '{}',
  notification_hours TEXT NOT NULL DEFAULT '[]',
  updated_at        TEXT NOT NULL
);

CREATE TABLE ${PREFIX}notification_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_id TEXT,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ${PREFIX}items (
  id TEXT PRIMARY KEY,
  calendar_mode TEXT NOT NULL DEFAULT 'solar',
  lunar_expiry_date TEXT
);

INSERT INTO ${PREFIX}users
  (id, email, password_hash, created_at, updated_at)
VALUES
  ('u1', 'u1@example.com', 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('u2', 'u2@example.com', 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO ${PREFIX}notification_configs
  (user_id, enabled_channels, telegram_config, gotify_config, notification_hours, updated_at)
VALUES
  ('u1', '["telegram"]', '{"bot_token":"secret"}', '{"server_url":"https://gotify.example.com","app_token":"tok"}', '[8,9]', '2026-01-01T00:00:00.000Z');
`;

function makeEnv(d1: SqliteD1): Env {
  return { DB: d1, TABLE_PREFIX: "en" } as unknown as Env;
}

type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

describe("notification_configs slack_config migration", () => {
  it("adds slack_config with a '{}' default and keeps existing data", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);

    const result = await runSetup(makeEnv(d1));
    expect(result).toEqual({ success: true, alreadyInitialized: true });

    const columns = d1.db
      .prepare(`PRAGMA table_info(${PREFIX}notification_configs)`)
      .all() as ColumnInfo[];
    const slackColumn = columns.find((c) => c.name === "slack_config");
    expect(slackColumn).toBeDefined();
    expect(slackColumn?.type).toBe("TEXT");
    expect(slackColumn?.notnull).toBe(1);
    expect(slackColumn?.dflt_value).toBe("'{}'");

    // The pre-existing row survives and is backfilled with the default.
    const row = d1.db
      .prepare(`SELECT * FROM ${PREFIX}notification_configs WHERE user_id = ?`)
      .get("u1") as Record<string, unknown>;
    expect(row.enabled_channels).toBe('["telegram"]');
    expect(row.telegram_config).toBe('{"bot_token":"secret"}');
    expect(row.gotify_config).toBe(
      '{"server_url":"https://gotify.example.com","app_token":"tok"}',
    );
    expect(row.notification_hours).toBe("[8,9]");
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.slack_config).toBe("{}");

    // New rows get the same default.
    d1.db
      .prepare(
        `INSERT INTO ${PREFIX}notification_configs (user_id, updated_at) VALUES (?, ?)`,
      )
      .run("u2", "2026-02-01T00:00:00.000Z");
    const newRow = d1.db
      .prepare(
        `SELECT slack_config FROM ${PREFIX}notification_configs WHERE user_id = ?`,
      )
      .get("u2") as Record<string, unknown>;
    expect(newRow.slack_config).toBe("{}");
  });

  it("is idempotent when the column already exists", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);

    await runSetup(makeEnv(d1));
    const second = await runSetup(makeEnv(d1));
    expect(second).toEqual({ success: true, alreadyInitialized: true });

    const rows = d1.db
      .prepare(`SELECT * FROM ${PREFIX}notification_configs`)
      .all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slack_config).toBe("{}");
  });
});

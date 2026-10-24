import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "../src/lib/setup";
import { sendNotifications } from "../src/services/notify/index";
import type { Env, NotificationConfig } from "../src/types";

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

describe("notification_configs default_channel migration", () => {
  it("adds an empty default, keeps existing data and is idempotent", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);

    await runSetup(makeEnv(d1));
    const columns = d1.db
      .prepare(`PRAGMA table_info(${PREFIX}notification_configs)`)
      .all() as ColumnInfo[];
    const column = columns.find((c) => c.name === "default_channel");
    expect(column).toMatchObject({
      type: "TEXT",
      notnull: 1,
      dflt_value: "''",
    });
    const row = d1.db
      .prepare(
        `SELECT * FROM ${PREFIX}notification_configs WHERE user_id = 'u1'`,
      )
      .get() as Record<string, unknown>;
    expect(row.default_channel).toBe("");
    expect(row.enabled_channels).toBe('["telegram"]');
    expect(row.notification_hours).toBe("[8,9]");

    await runSetup(makeEnv(d1));
    const after = d1.db
      .prepare(
        `SELECT * FROM ${PREFIX}notification_configs WHERE user_id = 'u1'`,
      )
      .get();
    expect(after).toEqual(row);
  });

  it("clears only retired default channels", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);
    d1.db
      .prepare(
        `ALTER TABLE ${PREFIX}notification_configs ADD COLUMN default_channel TEXT NOT NULL DEFAULT ''`,
      )
      .run();
    d1.db
      .prepare(
        `UPDATE ${PREFIX}notification_configs SET default_channel = 'gotify' WHERE user_id = 'u1'`,
      )
      .run();
    d1.db
      .prepare(
        `INSERT INTO ${PREFIX}notification_configs (user_id, enabled_channels, default_channel, updated_at)
         VALUES ('u2', '["bark"]', 'bark', '2026-01-01T00:00:00.000Z')`,
      )
      .run();

    await runSetup(makeEnv(d1));
    const rows = d1.db
      .prepare(
        `SELECT user_id, enabled_channels, default_channel FROM ${PREFIX}notification_configs ORDER BY user_id`,
      )
      .all();
    expect(rows).toEqual([
      { user_id: "u1", enabled_channels: '["telegram"]', default_channel: "" },
      { user_id: "u2", enabled_channels: '["bark"]', default_channel: "bark" },
    ]);
  });
});

describe("notification_configs slack_config migration", () => {
  it("adds slack_config with a '{}' default and keeps existing data", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);

    const result = await runSetup(makeEnv(d1));
    expect(result).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "en_",
    });

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
    expect(second).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "en_",
    });

    const rows = d1.db
      .prepare(`SELECT * FROM ${PREFIX}notification_configs`)
      .all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slack_config).toBe("{}");
  });
});

describe("notification_configs feishu/discord migration", () => {
  it("adds feishu_config and discord_config with a '{}' default and keeps existing data", async () => {
    const d1 = new SqliteD1();
    d1.db.exec(OLD_SCHEMA);

    await runSetup(makeEnv(d1));

    const columns = d1.db
      .prepare(`PRAGMA table_info(${PREFIX}notification_configs)`)
      .all() as ColumnInfo[];
    for (const name of ["feishu_config", "discord_config"]) {
      const column = columns.find((c) => c.name === name);
      expect(column).toBeDefined();
      expect(column?.type).toBe("TEXT");
      expect(column?.notnull).toBe(1);
      expect(column?.dflt_value).toBe("'{}'");
    }

    // Retired channel columns stay in place for existing databases; only the
    // type declarations and read/write code for them were removed.
    const names = columns.map((c) => c.name);
    expect(names).toContain("gotify_config");
    expect(names).toContain("notifyx_config");

    const row = d1.db
      .prepare(`SELECT * FROM ${PREFIX}notification_configs WHERE user_id = ?`)
      .get("u1") as Record<string, unknown>;
    expect(row.enabled_channels).toBe('["telegram"]');
    expect(row.telegram_config).toBe('{"bot_token":"secret"}');
    expect(row.gotify_config).toBe(
      '{"server_url":"https://gotify.example.com","app_token":"tok"}',
    );
    expect(row.feishu_config).toBe("{}");
    expect(row.discord_config).toBe("{}");
  });
});

/** Seed a legacy database whose enabled_channels still lists retired channels. */
function seedLegacyChannels(d1: SqliteD1): void {
  d1.db.exec(OLD_SCHEMA);
  d1.db
    .prepare(
      `UPDATE ${PREFIX}notification_configs
       SET enabled_channels = ?, telegram_config = ?
       WHERE user_id = ?`,
    )
    .run(
      '["telegram","serverchan","pushplus","gotify","notifyx"]',
      '{"bot_token":"secret","chat_id":"42"}',
      "u1",
    );
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_configs (user_id, enabled_channels, updated_at)
       VALUES (?, ?, ?)`,
    )
    .run("u2", '["bark"]', "2026-01-01T00:00:00.000Z");
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}users (id, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "u3",
      "u3@example.com",
      "hash",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_configs (user_id, enabled_channels, updated_at)
       VALUES (?, ?, ?)`,
    )
    .run("u3", "not-json", "2026-01-01T00:00:00.000Z");
  // Inserted after the malformed row (SQLite returns rows in rowid order here),
  // so this row is only cleaned if the migration skips bad rows one by one
  // instead of aborting the whole loop on the first parse error.
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}users (id, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "u4",
      "u4@example.com",
      "hash",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_configs (user_id, enabled_channels, updated_at)
       VALUES (?, ?, ?)`,
    )
    .run("u4", '["telegram","serverchan"]', "2026-01-01T00:00:00.000Z");
  // Mixed row: only the retired IDs go, the remaining channels keep their order.
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}users (id, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "u5",
      "u5@example.com",
      "hash",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_configs (user_id, enabled_channels, updated_at)
       VALUES (?, ?, ?)`,
    )
    .run(
      "u5",
      '["bark","gotify","email","notifyx"]',
      "2026-01-01T00:00:00.000Z",
    );
}

function enabledChannelsOf(d1: SqliteD1, userId: string): unknown {
  const row = d1.db
    .prepare(
      `SELECT enabled_channels FROM ${PREFIX}notification_configs WHERE user_id = ?`,
    )
    .get(userId) as Record<string, unknown>;
  return row.enabled_channels;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retired channel cleanup migration", () => {
  it("strips serverchan, pushplus, gotify and notifyx from enabled_channels", async () => {
    const d1 = new SqliteD1();
    seedLegacyChannels(d1);

    await runSetup(makeEnv(d1));

    expect(enabledChannelsOf(d1, "u1")).toBe('["telegram"]');
    // Rows without retired channels are left untouched.
    expect(enabledChannelsOf(d1, "u2")).toBe('["bark"]');
    // Only the retired IDs are removed; the remaining order is preserved.
    expect(enabledChannelsOf(d1, "u5")).toBe('["bark","email"]');
    // A malformed value is skipped without aborting the migration: u4 comes
    // after the bad row, so it is only stripped if processing continued.
    expect(enabledChannelsOf(d1, "u3")).toBe("not-json");
    expect(enabledChannelsOf(d1, "u4")).toBe('["telegram"]');
  });

  it("is idempotent", async () => {
    const d1 = new SqliteD1();
    seedLegacyChannels(d1);

    await runSetup(makeEnv(d1));
    const second = await runSetup(makeEnv(d1));
    expect(second).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "en_",
    });

    expect(enabledChannelsOf(d1, "u1")).toBe('["telegram"]');
    expect(enabledChannelsOf(d1, "u2")).toBe('["bark"]');
    expect(enabledChannelsOf(d1, "u3")).toBe("not-json");
    expect(enabledChannelsOf(d1, "u4")).toBe('["telegram"]');
    expect(enabledChannelsOf(d1, "u5")).toBe('["bark","email"]');
  });

  it("no longer reports unknown channels after the migration", async () => {
    const d1 = new SqliteD1();
    seedLegacyChannels(d1);
    await runSetup(makeEnv(d1));

    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const config = d1.db
      .prepare(`SELECT * FROM ${PREFIX}notification_configs WHERE user_id = ?`)
      .get("u1") as unknown as NotificationConfig;

    const results = await sendNotifications(
      config,
      { title: "Renewal due", body: "Your plan expires soon." },
      makeEnv(d1),
      {
        db: d1 as unknown as D1Database,
        prefix: PREFIX,
        userId: "u1",
      },
      ["telegram"],
    );

    expect(results).toEqual([{ channel: "telegram", success: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const history = d1.db
      .prepare(`SELECT channel, error FROM ${PREFIX}notification_history`)
      .all() as { channel: string; error: string | null }[];
    expect(history).toHaveLength(1);
    expect(history[0].channel).toBe("telegram");
    expect(history[0].error).toBeNull();
  });
});

describe("fresh install schema", () => {
  it("creates notification_configs without the retired channel columns", async () => {
    const d1 = new SqliteD1();

    const result = await runSetup(makeEnv(d1));
    expect(result).toEqual({ success: true, effectivePrefix: "en_" });

    const columns = d1.db
      .prepare(`PRAGMA table_info(${PREFIX}notification_configs)`)
      .all() as ColumnInfo[];
    const names = columns.map((c) => c.name);
    expect(names).not.toContain("serverchan_config");
    expect(names).not.toContain("pushplus_config");
    expect(names).not.toContain("gotify_config");
    expect(names).not.toContain("notifyx_config");
    expect(names).toContain("default_channel");
    expect(names).toContain("slack_config");
    expect(names).toContain("feishu_config");
    expect(names).toContain("discord_config");
  });
});

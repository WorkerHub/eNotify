/**
 * Test support for the export/import ("backup") endpoints.
 *
 * D1 is SQLite, so these tests run the production SQL against a real in-memory
 * SQLite database (`node:sqlite`, built into Node 22+/24) initialized from the
 * repository's own `worker/src/db/schema.sql`. That keeps the assertions about
 * defaults, constraints, foreign keys and batch atomicity honest instead of
 * testing a hand-written mock.
 */
// @ts-expect-error node:sqlite ships with Node but is not in the Workers type set.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../../src/index";
import { MockKV, TEST_JWT_SECRET, TEST_SETUP_SECRET } from "../helpers";
import type { Env } from "../../src/types";

const SCHEMA_TEMPLATE = readFileSync(
  new URL("../../src/db/schema.sql", import.meta.url),
  "utf8",
);

export type Row = Record<string, unknown>;

class SqliteStatement {
  args: unknown[] = [];

  constructor(
    private readonly db: SqliteD1,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]): this {
    // D1 rejects undefined/boolean bindings; mirror that by normalizing only
    // what the code under test is allowed to bind.
    this.args = args.map((arg) => (arg === undefined ? null : arg));
    return this;
  }

  async first<T>(): Promise<T | null> {
    const rows = this.db.execStatement(this.sql, this.args) as T[];
    return rows.length > 0 ? rows[0] : null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.execStatement(this.sql, this.args) as T[] };
  }

  async run(): Promise<{ success: true }> {
    this.db.execStatement(this.sql, this.args);
    return { success: true };
  }
}

export class SqliteD1 {
  readonly raw: DatabaseSync;
  /** Optional failure injection: return true to make that statement throw. */
  failWhen: ((sql: string) => boolean) | null = null;
  batchCalls = 0;

  constructor(options: { prefix?: string; schema?: boolean } = {}) {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON");
    if (options.schema !== false) {
      const prefix = options.prefix ?? "";
      this.raw.exec(SCHEMA_TEMPLATE.replace(/\{prefix\}/g, prefix));
    }
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this, sql);
  }

  /**
   * Mirrors D1: a batch runs as a single transaction, so one failing statement
   * rolls the whole batch back.
   */
  async batch(statements: SqliteStatement[]): Promise<unknown[]> {
    this.batchCalls += 1;
    this.raw.exec("BEGIN");
    const results: unknown[] = [];
    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }

  execStatement(sql: string, args: unknown[]): unknown[] {
    if (this.failWhen?.(sql)) {
      throw new Error(`injected failure for statement: ${sql.slice(0, 60)}`);
    }
    const prepared = this.raw.prepare(sql);
    if (/^\s*(select|pragma|with)\b/i.test(sql)) {
      return prepared.all(...(args as never[])) as unknown[];
    }
    prepared.run(...(args as never[]));
    return [];
  }

  // ── direct helpers for fixtures and assertions ────────────────────────────

  insert(table: string, row: Row): void {
    const columns = Object.keys(row);
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`;
    this.execStatement(
      sql,
      columns.map((column) => row[column] ?? null),
    );
  }

  select<T = Row>(sql: string, ...args: unknown[]): T[] {
    return this.execStatement(sql, args) as T[];
  }

  count(table: string): number {
    const rows = this.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}`,
    );
    return Number(rows[0]?.n ?? 0);
  }
}

export interface BackupTestEnv extends Record<string, unknown> {
  DB: SqliteD1;
  KV: MockKV;
}

export function makeBackupEnv(
  db: SqliteD1,
  overrides: Record<string, unknown> = {},
): BackupTestEnv {
  return {
    DB: db,
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "",
    ASSETS: {},
    ...overrides,
  };
}

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

export interface BackupResponse {
  status: number;
  body: any;
  headers: Headers;
  text: string;
}

/** Calls the real worker app (index.ts) so routing/middleware are covered. */
export async function callWorker(
  env: BackupTestEnv,
  path: string,
  init: RequestInit = {},
): Promise<BackupResponse> {
  const res = await worker.fetch(
    new Request(`https://enotify.test${path}`, init),
    env as unknown as Env,
    executionCtx,
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers, text };
}

export function jsonPost(
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

// ─── fixture: a fully populated source instance ───────────────────────────────

export const BOB = {
  id: "u-bob",
  email: "bob@example.com",
};

export const ADMIN = {
  id: "u-admin",
  email: "admin@example.com",
};

export const CAROL = {
  id: "u-carol",
  email: "carol@example.com",
};

/**
 * Seeds one admin, two regular users, and rows in all seven tables — including
 * a row whose `channels` JSON is deliberately malformed to exercise `_raw`.
 */
export function seedInstance(db: SqliteD1): void {
  const now = "2026-10-25T10:00:00.000Z";

  db.insert("users", {
    id: ADMIN.id,
    email: ADMIN.email,
    password_hash: "$argon2id$admin-hash",
    role: "admin",
    is_active: 1,
    email_verified: 1,
    base_currency: "USD",
    timezone: "Asia/Shanghai",
    language: "en",
    theme: "dark",
    created_at: now,
    updated_at: now,
  });
  db.insert("users", {
    id: BOB.id,
    email: BOB.email,
    password_hash: "$argon2id$bob-hash",
    role: "user",
    is_active: 1,
    email_verified: 0,
    base_currency: "CNY",
    timezone: "UTC",
    language: "zh",
    theme: "system",
    created_at: now,
    updated_at: now,
  });
  db.insert("users", {
    id: CAROL.id,
    email: CAROL.email,
    password_hash: "$argon2id$carol-hash",
    role: "user",
    is_active: 1,
    email_verified: 1,
    base_currency: "CNY",
    timezone: "UTC",
    language: "zh",
    theme: "system",
    created_at: now,
    updated_at: now,
  });

  db.insert("user_2fa", {
    user_id: BOB.id,
    totp_secret: "JBSWY3DPEHPK3PXP",
    totp_enabled: 1,
    passkey_credentials: JSON.stringify([
      {
        id: "cred-1",
        publicKey: "pk-base64",
        counter: 3,
        transports: ["internal"],
      },
    ]),
    passkey_enabled: 1,
    email_otp_enabled: 0,
    preferred_method: "totp",
    updated_at: now,
  });

  db.insert("items", {
    id: "item-bob-1",
    user_id: BOB.id,
    name: "VPS",
    item_mode: "cycle",
    category: "server",
    start_date: "2026-01-01",
    expiry_date: "2026-11-01",
    period_value: 1,
    period_unit: "month",
    reminder_unit: "day",
    reminder_value: 7,
    notes: "note-1",
    amount: 12.5,
    currency: "USD",
    last_payment_date: "2026-10-01",
    is_active: 1,
    auto_renew: 1,
    calendar_mode: "lunar",
    lunar_expiry_date: "2026-09-15",
    channels: JSON.stringify(["telegram", "email"]),
    notification_hours: JSON.stringify([9, 21]),
    item_kind: "subscription",
    created_at: now,
    updated_at: now,
  });
  db.insert("items", {
    id: "item-bob-broken",
    user_id: BOB.id,
    name: "Broken JSON",
    item_mode: "reset",
    category: "",
    start_date: null,
    expiry_date: "2026-12-31",
    period_value: 2,
    period_unit: "week",
    reminder_unit: "hour",
    reminder_value: 3,
    notes: "",
    amount: null,
    currency: "CNY",
    last_payment_date: null,
    is_active: 0,
    auto_renew: 0,
    calendar_mode: "solar",
    lunar_expiry_date: null,
    // Deliberately invalid JSON: must survive via the `_raw` marker.
    channels: '{"broken": ',
    notification_hours: "[]",
    item_kind: "regular",
    created_at: now,
    updated_at: now,
  });
  db.insert("items", {
    id: "item-admin-1",
    user_id: ADMIN.id,
    name: "Domain",
    item_mode: "cycle",
    category: "",
    start_date: null,
    expiry_date: "2027-01-01",
    period_value: 1,
    period_unit: "year",
    reminder_unit: "day",
    reminder_value: 14,
    notes: "",
    amount: 88,
    currency: "CNY",
    last_payment_date: null,
    is_active: 1,
    auto_renew: 1,
    calendar_mode: "both",
    lunar_expiry_date: "2026-11-20",
    channels: JSON.stringify([]),
    notification_hours: JSON.stringify([]),
    item_kind: "regular",
    created_at: now,
    updated_at: now,
  });

  db.insert("payment_history", {
    id: "pay-bob-1",
    item_id: "item-bob-1",
    user_id: BOB.id,
    date: "2026-10-01",
    amount: 12.5,
    currency: "USD",
    type: "auto",
    note: "october",
    period_start: "2026-10-01",
    period_end: "2026-11-01",
    created_at: now,
  });
  db.insert("payment_history", {
    id: "pay-admin-1",
    item_id: "item-admin-1",
    user_id: ADMIN.id,
    date: "2026-10-02",
    amount: 88,
    currency: "CNY",
    type: "manual",
    note: "",
    period_start: null,
    period_end: null,
    created_at: now,
  });

  db.insert("notification_configs", {
    user_id: BOB.id,
    enabled_channels: JSON.stringify(["telegram", "email"]),
    default_channel: "telegram",
    telegram_config: JSON.stringify({
      bot_token: "123:abc",
      chat_id: "-100",
    }),
    webhook_config: "{}",
    wechatbot_config: "{}",
    email_config: JSON.stringify({ to: "bob@example.com", smtp_host: "smtp" }),
    bark_config: "{}",
    slack_config: "{}",
    feishu_config: "{}",
    discord_config: "{}",
    notification_hours: JSON.stringify([8, 20]),
    updated_at: now,
  });
  db.insert("notification_configs", {
    user_id: ADMIN.id,
    enabled_channels: JSON.stringify(["email"]),
    default_channel: "email",
    telegram_config: "{}",
    webhook_config: "{}",
    wechatbot_config: "{}",
    email_config: "{}",
    bark_config: "{}",
    slack_config: "{}",
    feishu_config: "{}",
    discord_config: "{}",
    notification_hours: JSON.stringify([]),
    updated_at: now,
  });

  db.insert("system_settings", {
    key: "app_name",
    value: "eNotify",
    updated_at: now,
  });
  db.insert("system_settings", {
    key: "smtp_config",
    value: JSON.stringify({ host: "smtp.example.com", password: "s3cret" }),
    updated_at: now,
  });

  db.insert("notification_history", {
    id: "hist-1",
    user_id: BOB.id,
    item_id: "item-bob-1",
    channel: "telegram",
    title: "VPS expiring",
    body: "body",
    success: 1,
    error: null,
    created_at: now,
  });
}

/** Every row of every table, for whole-database equality assertions. */
export function dumpTables(db: SqliteD1): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const table of [
    "users",
    "user_2fa",
    "items",
    "payment_history",
    "notification_configs",
    "system_settings",
    "notification_history",
  ]) {
    out[table] = db.select(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  return out;
}

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  insertNotificationHistory,
  listNotificationHistory,
} from "../src/db/queries/notification-history";
import { runSetup } from "../src/lib/setup";
import { meRoutes } from "../src/routes/me";
import { notifyRoutes } from "../src/routes/notify";
import { sendNotifications } from "../src/services/notify/index";
import type { Env, NotificationConfig } from "../src/types";
import {
  cookieHeader,
  makeToken,
  MockKV,
  request,
  seedSession,
  TEST_JWT_SECRET,
  TEST_SETUP_SECRET,
} from "./helpers";
import { SqliteD1 } from "./support/sqlite-d1";

const PREFIX = "en_";
const FILTER_INDEX = `idx_${PREFIX}notification_history_filter`;

function makeEnv(d1: SqliteD1): Env {
  return {
    DB: d1,
    KV: new MockKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    SETUP_SECRET: TEST_SETUP_SECRET,
    TABLE_PREFIX: "en",
    ASSETS: {},
  } as unknown as Env;
}

async function seededEnv(): Promise<{ d1: SqliteD1; env: Env }> {
  const d1 = new SqliteD1();
  const env = makeEnv(d1);
  const result = await runSetup(env);
  expect(result.success).toBe(true);
  return { d1, env };
}

function makeApp(): Hono {
  const app = new Hono();
  app.route("/api/me", meRoutes);
  app.route("/api/notify", notifyRoutes);
  return app;
}

async function login(env: Env): Promise<{ headers: Record<string, string> }> {
  await seedSession(env as unknown as Record<string, unknown>, "u1", "s1");
  const token = await makeToken("user", { sub: "u1", sid: "s1" });
  return { headers: cookieHeader(token) };
}

function seedRow(
  d1: SqliteD1,
  row: {
    id: string;
    user?: string;
    channel?: string;
    success?: boolean;
    source?: string | null;
    createdAt?: string;
  },
): void {
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_history
         (id, user_id, item_id, channel, title, body, success, error, trigger_source, created_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run(
      row.id,
      row.user ?? "u1",
      row.channel ?? "telegram",
      `title-${row.id}`,
      row.success === false ? 0 : 1,
      row.source === undefined ? null : row.source,
      row.createdAt ?? "2026-01-01T00:00:00.000Z",
    );
}

function seedHistory(d1: SqliteD1): void {
  seedRow(d1, {
    id: "h1",
    source: "item",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  seedRow(d1, {
    id: "h2",
    source: "item",
    success: false,
    createdAt: "2026-01-02T00:00:00.000Z",
  });
  seedRow(d1, {
    id: "h3",
    channel: "bark",
    source: "api",
    success: false,
    createdAt: "2026-01-03T00:00:00.000Z",
  });
  seedRow(d1, {
    id: "h4",
    source: "test",
    createdAt: "2026-01-04T00:00:00.000Z",
  });
  seedRow(d1, {
    id: "h5",
    user: "u2",
    source: "item",
    createdAt: "2026-01-05T00:00:00.000Z",
  });
  seedRow(d1, {
    id: "h6",
    source: null,
    createdAt: "2026-01-06T00:00:00.000Z",
  });
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

function notifyConfig(): NotificationConfig {
  return {
    user_id: "u1",
    enabled_channels: JSON.stringify(["telegram"]),
    default_channel: "telegram",
    telegram_config: JSON.stringify({ bot_token: "token", chat_id: "1" }),
    webhook_config: "{}",
    wechatbot_config: "{}",
    email_config: "{}",
    bark_config: "{}",
    slack_config: "{}",
    feishu_config: "{}",
    discord_config: "{}",
    notification_hours: "[]",
    updated_at: "",
  };
}

function seedNotificationConfig(d1: SqliteD1): void {
  d1.db
    .prepare(
      `INSERT OR IGNORE INTO ${PREFIX}users
         (id, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "u1",
      "u1@example.com",
      "hash",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
  d1.db
    .prepare(
      `INSERT INTO ${PREFIX}notification_configs
         (user_id, enabled_channels, default_channel, telegram_config, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "u1",
      JSON.stringify(["telegram"]),
      "telegram",
      JSON.stringify({ bot_token: "token", chat_id: "1" }),
      "2026-01-01T00:00:00.000Z",
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("schema_v2", () => {
  it("adds trigger_source and the filter index", async () => {
    const { d1 } = await seededEnv();

    const columns = d1.db
      .prepare(`PRAGMA table_info(${PREFIX}notification_history)`)
      .all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("trigger_source");

    const index = d1.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
      .get(FILTER_INDEX) as { name: string } | undefined;
    expect(index).toEqual({ name: FILTER_INDEX });
  });
});

describe("insertNotificationHistory", () => {
  it("writes trigger_source and leaves it NULL when omitted", async () => {
    const { d1 } = await seededEnv();

    await insertNotificationHistory(d1 as unknown as D1Database, PREFIX, {
      id: "h-api",
      user_id: "u1",
      channel: "telegram",
      title: "api",
      success: true,
      trigger_source: "api",
    });
    await insertNotificationHistory(d1 as unknown as D1Database, PREFIX, {
      id: "h-legacy",
      user_id: "u1",
      channel: "telegram",
      title: "legacy",
      success: false,
      error: "boom",
    });

    const rows = d1.db
      .prepare(
        `SELECT id, trigger_source FROM ${PREFIX}notification_history ORDER BY id`,
      )
      .all() as { id: string; trigger_source: string | null }[];
    expect(rows).toEqual([
      { id: "h-api", trigger_source: "api" },
      { id: "h-legacy", trigger_source: null },
    ]);
  });
});

describe("listNotificationHistory filters", () => {
  it("filters by channel, success and trigger source with exact matches", async () => {
    const { d1 } = await seededEnv();
    seedHistory(d1);
    const db = d1 as unknown as D1Database;

    expect(ids(await listNotificationHistory(db, PREFIX, "u1"))).toEqual([
      "h6",
      "h4",
      "h3",
      "h2",
      "h1",
    ]);
    expect(
      ids(await listNotificationHistory(db, PREFIX, "u1", { channel: "bark" })),
    ).toEqual(["h3"]);
    expect(
      ids(await listNotificationHistory(db, PREFIX, "u1", { success: false })),
    ).toEqual(["h3", "h2"]);
    expect(
      ids(
        await listNotificationHistory(db, PREFIX, "u1", {
          triggerSource: "item",
        }),
      ),
    ).toEqual(["h2", "h1"]);
    expect(
      ids(
        await listNotificationHistory(db, PREFIX, "u1", {
          channel: "telegram",
          success: false,
          triggerSource: "item",
        }),
      ),
    ).toEqual(["h2"]);
    expect(
      ids(await listNotificationHistory(db, PREFIX, "u1", { limit: 2 })),
    ).toEqual(["h6", "h4"]);
  });

  it("never returns another user's rows", async () => {
    const { d1 } = await seededEnv();
    seedHistory(d1);

    const rows = await listNotificationHistory(
      d1 as unknown as D1Database,
      PREFIX,
      "u2",
    );
    expect(ids(rows)).toEqual(["h5"]);
  });
});

describe("GET /api/me/notification-history", () => {
  it("translates query parameters into filters", async () => {
    const { d1, env } = await seededEnv();
    seedHistory(d1);
    const auth = await login(env);

    const filtered = await request(
      makeApp(),
      env,
      "/api/me/notification-history?channel=telegram&success=false&trigger_source=item",
      { headers: auth.headers },
    );
    expect(filtered.status).toBe(200);
    expect(ids(filtered.body)).toEqual(["h2"]);

    const limited = await request(
      makeApp(),
      env,
      "/api/me/notification-history?limit=2",
      { headers: auth.headers },
    );
    expect(ids(limited.body)).toEqual(["h6", "h4"]);
  });

  it("ignores an invalid success value and a non-numeric limit", async () => {
    const { d1, env } = await seededEnv();
    seedHistory(d1);
    const auth = await login(env);

    const res = await request(
      makeApp(),
      env,
      "/api/me/notification-history?success=maybe&limit=abc",
      { headers: auth.headers },
    );
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(["h6", "h4", "h3", "h2", "h1"]);
  });
});

describe("notification writers record their trigger source", () => {
  it("sendNotifications persists context.triggerSource", async () => {
    const { d1, env } = await seededEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    const results = await sendNotifications(
      notifyConfig(),
      { title: "Test", body: "Body" },
      env,
      {
        db: d1 as unknown as D1Database,
        prefix: PREFIX,
        userId: "u1",
        itemId: null,
        triggerSource: "item",
      },
      ["telegram"],
    );
    expect(results).toEqual([{ channel: "telegram", success: true }]);

    const row = d1.db
      .prepare(
        `SELECT trigger_source, item_id FROM ${PREFIX}notification_history`,
      )
      .get() as { trigger_source: string; item_id: string | null };
    expect(row).toEqual({ trigger_source: "item", item_id: null });
  });

  it("POST /api/me/notifications/test writes trigger_source 'test'", async () => {
    const { d1, env } = await seededEnv();
    seedNotificationConfig(d1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const auth = await login(env);

    const res = await request(makeApp(), env, "/api/me/notifications/test", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "telegram" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const row = d1.db
      .prepare(`SELECT trigger_source FROM ${PREFIX}notification_history`)
      .get() as { trigger_source: string };
    expect(row.trigger_source).toBe("test");
  });

  it("POST /api/notify writes trigger_source 'api' with no item", async () => {
    const { d1, env } = await seededEnv();
    seedNotificationConfig(d1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const auth = await login(env);

    const res = await request(makeApp(), env, "/api/notify", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = d1.db
      .prepare(
        `SELECT trigger_source, item_id FROM ${PREFIX}notification_history`,
      )
      .get() as { trigger_source: string; item_id: string | null };
    expect(row).toEqual({ trigger_source: "api", item_id: null });
  });
});

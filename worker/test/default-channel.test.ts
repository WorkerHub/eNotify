import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotifications } from "../src/services/notify/index";
import { notifyRoutes } from "../src/routes/notify";
import { itemRoutes } from "../src/routes/items";
import { handleScheduled } from "../src/services/scheduler";
import type { Env, NotificationConfig } from "../src/types";
import {
  cookieHeader,
  makeToken,
  MockKV,
  request,
  seedSession,
} from "./helpers";

class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");

  constructor() {
    this.db.exec(`
      CREATE TABLE notification_configs (
        user_id TEXT PRIMARY KEY,
        enabled_channels TEXT NOT NULL DEFAULT '[]',
        default_channel TEXT NOT NULL DEFAULT '',
        telegram_config TEXT NOT NULL DEFAULT '{}',
        webhook_config TEXT NOT NULL DEFAULT '{}',
        wechatbot_config TEXT NOT NULL DEFAULT '{}',
        email_config TEXT NOT NULL DEFAULT '{}',
        bark_config TEXT NOT NULL DEFAULT '{}',
        slack_config TEXT NOT NULL DEFAULT '{}',
        feishu_config TEXT NOT NULL DEFAULT '{}',
        discord_config TEXT NOT NULL DEFAULT '{}',
        notification_hours TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, user_id TEXT, name TEXT, item_mode TEXT,
        category TEXT, start_date TEXT, expiry_date TEXT, period_value INTEGER,
        period_unit TEXT, reminder_unit TEXT, reminder_value INTEGER, notes TEXT,
        amount REAL, currency TEXT, last_payment_date TEXT, is_active INTEGER,
        auto_renew INTEGER, calendar_mode TEXT, lunar_expiry_date TEXT,
        channels TEXT, notification_hours TEXT, item_kind TEXT,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, timezone TEXT, language TEXT, is_active INTEGER);
      CREATE TABLE notification_history (
        id TEXT, user_id TEXT, item_id TEXT, channel TEXT, title TEXT,
        body TEXT, success INTEGER, error TEXT, trigger_source TEXT,
        created_at TEXT
      );
    `);
  }

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

function config(defaultChannel = "telegram"): NotificationConfig {
  return {
    user_id: "user-1",
    enabled_channels: JSON.stringify(["telegram", "bark", "email"]),
    default_channel: defaultChannel,
    telegram_config: '{"bot_token":"token","chat_id":"1"}',
    webhook_config: "{}",
    wechatbot_config: "{}",
    email_config: "{}",
    bark_config: '{"device_key":"key"}',
    slack_config: "{}",
    feishu_config: "{}",
    discord_config: "{}",
    notification_hours: "[]",
    updated_at: "",
  };
}

const MESSAGE = { title: "Test", body: "Body" };

function calledChannels(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => {
    const value = String(url);
    if (value.includes("api.telegram.org")) return "telegram";
    if (value.includes("api.day.app")) return "bark";
    throw new Error(`Unexpected sender URL: ${value}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sendNotifications default-channel resolution", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it.each([
    ["omitted", undefined, ["telegram"]],
    ["empty", [], ["telegram"]],
    ["single selected", ["bark"], ["bark"]],
    ["multiple selected", ["bark", "email"], ["bark", "email"]],
  ])(
    "uses the expected targets when channels are %s",
    async (_name, channels, expected) => {
      const results = await sendNotifications(
        config(),
        MESSAGE,
        {} as Env,
        undefined,
        channels,
      );
      expect(results.map((r) => r.channel)).toEqual(expected);
      expect(calledChannels(fetchMock)).toEqual(
        expected.filter((c) => c !== "email"),
      );
    },
  );

  it("throws when no requested channel is enabled and sends nothing", async () => {
    await expect(
      sendNotifications(config(), MESSAGE, {} as Env, undefined, ["wechatbot"]),
    ).rejects.toThrow("None of the requested channels are enabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when no default is configured", async () => {
    await expect(
      sendNotifications(config(""), MESSAGE, {} as Env),
    ).rejects.toThrow("No default channel configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the default is not enabled", async () => {
    await expect(
      sendNotifications(config("wechatbot"), MESSAGE, {} as Env),
    ).rejects.toThrow("Default channel is not enabled: wechatbot");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function makeRouteEnv(db: SqliteD1, defaultChannel = "telegram") {
  const current = config(defaultChannel);
  db.db
    .prepare(
      `INSERT INTO notification_configs
       (user_id, enabled_channels, default_channel, telegram_config, bark_config)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "user-1",
      current.enabled_channels,
      defaultChannel,
      current.telegram_config,
      current.bark_config,
    );
  const env: Record<string, unknown> = {
    DB: db,
    KV: new MockKV(),
    JWT_SECRET: "test-jwt-secret-0123456789abcdef",
    TABLE_PREFIX: "",
  };
  await seedSession(env, "user-1", "session-1");
  return env;
}

async function token() {
  return makeToken("user", { sub: "user-1", sid: "session-1" });
}

describe("POST /api/notify channel routing", () => {
  let db: SqliteD1;
  let app: Hono;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new SqliteD1();
    app = new Hono();
    app.route("/api/notify", notifyRoutes);
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  async function post(body: unknown, defaultChannel = "telegram") {
    const env = await makeRouteEnv(db, defaultChannel);
    return request(app, env, "/api/notify", {
      method: "POST",
      headers: {
        ...cookieHeader(await token()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("sends only selected channels", async () => {
    const res = await post({ title: "Test", channels: ["telegram", "bark"] });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => r.channel)).toEqual([
      "telegram",
      "bark",
    ]);
  });

  it("rejects an unknown channel without sending", async () => {
    const res = await post({ channels: ["unknown"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid channel name: unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a valid but disabled channel without sending", async () => {
    const res = await post({ channels: ["wechatbot"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Channel not enabled: wechatbot");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only the default when channels are omitted", async () => {
    const res = await post({ title: "Test" });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => r.channel)).toEqual(["telegram"]);
  });

  it("returns 400 without sending after the default is cleared", async () => {
    const res = await post({ title: "Test" }, "");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No default channel configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-array channels value", async () => {
    const res = await post({ channels: "telegram" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("channels must be an array");
  });
});

describe("item and scheduler default-channel paths", () => {
  let db: SqliteD1;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new SqliteD1();
    fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  function seedItem() {
    db.db
      .prepare(
        `INSERT INTO items
         (id, user_id, name, item_mode, category, expiry_date, period_value,
          period_unit, reminder_unit, reminder_value, notes, currency, is_active,
          auto_renew, calendar_mode, channels, notification_hours, item_kind)
         VALUES ('item-1', 'user-1', 'Test item', 'cycle', '', ?, 1, 'month',
          'day', 30, '', 'CNY', 1, 0, 'solar', '[]', '[]', 'subscription')`,
      )
      .run(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    db.db.prepare("INSERT INTO users VALUES ('user-1', 'UTC', 'en', 1)").run();
  }

  it("test-notify uses the default and returns 400 when none is set", async () => {
    seedItem();
    const app = new Hono();
    app.route("/api/items", itemRoutes);
    const env = await makeRouteEnv(db);
    const headers = cookieHeader(await token());
    const success = await request(app, env, "/api/items/item-1/test-notify", {
      method: "POST",
      headers,
    });
    expect(success.status).toBe(200);
    expect(success.body.results.map((r: any) => r.channel)).toEqual([
      "telegram",
    ]);

    db.db.prepare("UPDATE notification_configs SET default_channel = ''").run();
    const failure = await request(app, env, "/api/items/item-1/test-notify", {
      method: "POST",
      headers,
    });
    expect(failure.status).toBe(400);
    expect(failure.body.error).toBe("No default channel configured");
  });

  it("scheduler skips dedupe on resolution failure and succeeds after fixing the default", async () => {
    seedItem();
    const env = (await makeRouteEnv(db, "")) as unknown as Env;
    const kv = env.KV as unknown as MockKV;
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleScheduled(env);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      [...kv.store.keys()].some((k) => k.startsWith("notify_dedupe:")),
    ).toBe(false);
    expect(errorMock).toHaveBeenCalledWith(
      expect.stringContaining("item-1"),
      "No default channel configured",
    );

    db.db
      .prepare("UPDATE notification_configs SET default_channel = 'telegram'")
      .run();
    await handleScheduled(env);
    expect(calledChannels(fetchMock)).toEqual(["telegram"]);
    expect(
      [...kv.store.keys()].some((k) => k.startsWith("notify_dedupe:")),
    ).toBe(true);
  });
});

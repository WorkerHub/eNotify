import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { meRoutes } from "../src/routes/me";
import {
  cookieHeader,
  MockKV,
  makeToken,
  request,
  seedSession,
} from "./helpers";

// Minimal in-memory stand-in for the `notification_configs` table, enough for
// the GET/PUT notification-config round trip in routes/me.ts.
class ConfigDB {
  rows = new Map<string, Record<string, any>>();

  prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ");

    if (/^SELECT \* FROM .*notification_configs WHERE user_id = \?/i.test(s)) {
      return {
        bind: (userId: string) => ({
          first: async () => this.rows.get(userId) ?? null,
        }),
      };
    }

    if (/^INSERT INTO .*notification_configs/i.test(s)) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            const cols = (s.match(/\(([^)]*)\) VALUES/i)?.[1] ?? "")
              .split(",")
              .map((c) => c.trim());
            const userId = String(args[0]);
            const row: Record<string, any> = {};
            cols.forEach((col, i) => {
              row[col] = args[i];
            });
            this.rows.set(userId, row);
            return { success: true };
          },
        }),
      };
    }

    throw new Error(`ConfigDB: unsupported SQL: ${s}`);
  }
}

function makeApp() {
  const app = new Hono();
  app.route("/api/me", meRoutes);
  return app;
}

async function makeLoggedInEnv(db: ConfigDB): Promise<Record<string, unknown>> {
  const env: Record<string, unknown> = {
    DB: db,
    KV: new MockKV(),
    JWT_SECRET: "test-jwt-secret-0123456789abcdef",
    SETUP_SECRET: "test-setup-secret",
    TABLE_PREFIX: "",
    ASSETS: {},
  };
  await seedSession(env, "user-1", "session-1");
  return env;
}

describe("GET/PUT /api/me/notifications — per-user SMTP credentials", () => {
  let db: ConfigDB;
  let app: Hono;
  let env: Record<string, unknown>;
  let token: string;

  beforeEach(async () => {
    db = new ConfigDB();
    app = makeApp();
    env = await makeLoggedInEnv(db);
    token = await makeToken("user", { sub: "user-1", sid: "session-1" });
  });

  it("stores the SMTP fields sent by the client", async () => {
    const res = await request(app, env, "/api/me/notifications", {
      method: "PUT",
      headers: { ...cookieHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled_channels: ["email"],
        email_config: {
          to: "user@example.com",
          smtp_host: "smtp.example.com",
          smtp_port: "465",
          smtp_username: "login@example.com",
          smtp_password: "s3cret-pass",
          smtp_from: "notify@example.com",
        },
      }),
    });

    expect(res.status).toBe(200);
    const stored = JSON.parse(db.rows.get("user-1")?.email_config ?? "{}");
    expect(stored).toEqual({
      to: "user@example.com",
      smtp_host: "smtp.example.com",
      smtp_port: "465",
      smtp_username: "login@example.com",
      smtp_password: "s3cret-pass",
      smtp_from: "notify@example.com",
    });
  });

  it("masks smtp_password on read and keeps the stored password when the mask is sent back", async () => {
    db.rows.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["email"]),
      notification_hours: JSON.stringify([]),
      email_config: JSON.stringify({
        to: "user@example.com",
        smtp_host: "smtp.example.com",
        smtp_port: "587",
        smtp_username: "login@example.com",
        smtp_password: "s3cret-pass",
        smtp_from: "notify@example.com",
      }),
      updated_at: new Date().toISOString(),
    });

    const got = await request(app, env, "/api/me/notifications", {
      headers: cookieHeader(token),
    });
    expect(got.status).toBe(200);
    expect(got.body.email_config).toEqual({
      to: "user@example.com",
      smtp_host: "smtp.example.com",
      smtp_port: "587",
      smtp_username: "login@example.com",
      smtp_password: "••••••",
      smtp_from: "notify@example.com",
    });
    expect(got.body.email_configured).toBe(true);

    const put = await request(app, env, "/api/me/notifications", {
      method: "PUT",
      headers: { ...cookieHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        email_config: {
          ...got.body.email_config,
          smtp_port: "465",
        },
      }),
    });
    expect(put.status).toBe(200);

    const stored = JSON.parse(db.rows.get("user-1")?.email_config ?? "{}");
    expect(stored.smtp_password).toBe("s3cret-pass");
    expect(stored.smtp_port).toBe("465");
  });

  it("keeps the stored password when an empty password is sent back", async () => {
    db.rows.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["email"]),
      notification_hours: JSON.stringify([]),
      email_config: JSON.stringify({
        to: "user@example.com",
        smtp_host: "smtp.example.com",
        smtp_username: "login@example.com",
        smtp_password: "s3cret-pass",
      }),
      updated_at: new Date().toISOString(),
    });

    const res = await request(app, env, "/api/me/notifications", {
      method: "PUT",
      headers: { ...cookieHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        email_config: {
          to: "user@example.com",
          smtp_host: "smtp.example.com",
          smtp_username: "login@example.com",
          smtp_password: "",
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(
      JSON.parse(db.rows.get("user-1")?.email_config ?? "{}").smtp_password,
    ).toBe("s3cret-pass");
  });
});

describe("GET /api/me/notifications — email_configured", () => {
  let db: ConfigDB;
  let app: Hono;
  let env: Record<string, unknown>;
  let token: string;

  beforeEach(async () => {
    db = new ConfigDB();
    app = makeApp();
    env = await makeLoggedInEnv(db);
    token = await makeToken("user", { sub: "user-1", sid: "session-1" });
  });

  async function configuredFor(emailConfig: Record<string, unknown>) {
    db.rows.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["email"]),
      notification_hours: JSON.stringify([]),
      email_config: JSON.stringify(emailConfig),
      updated_at: new Date().toISOString(),
    });
    const res = await request(app, env, "/api/me/notifications", {
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(200);
    return res.body;
  }

  it("is true only when both to and smtp_host are filled in", async () => {
    const both = await configuredFor({
      to: "user@example.com",
      smtp_host: "smtp.example.com",
    });
    expect(both.email_configured).toBe(true);
  });

  it("is false when only the recipient is configured", async () => {
    const onlyTo = await configuredFor({ to: "user@example.com" });
    expect(onlyTo.email_configured).toBe(false);
  });

  it("is false when only the SMTP host is configured", async () => {
    const onlyHost = await configuredFor({ smtp_host: "smtp.example.com" });
    expect(onlyHost.email_configured).toBe(false);
  });

  it("is false for whitespace-only values and for an empty config", async () => {
    const blank = await configuredFor({ to: "   ", smtp_host: "  " });
    expect(blank.email_configured).toBe(false);

    const empty = await configuredFor({});
    expect(empty.email_configured).toBe(false);
  });

  it("does not tighten the heuristic for other channels", async () => {
    db.rows.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["telegram", "email"]),
      notification_hours: JSON.stringify([]),
      telegram_config: JSON.stringify({ token: "123:abc", chat_id: "1" }),
      email_config: JSON.stringify({ to: "user@example.com" }),
      updated_at: new Date().toISOString(),
    });
    const res = await request(app, env, "/api/me/notifications", {
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.body.telegram_configured).toBe(true);
    expect(res.body.email_configured).toBe(false);
  });
});

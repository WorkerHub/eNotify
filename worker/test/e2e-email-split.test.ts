import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { adminRoutes } from "../src/routes/admin";
import { meRoutes } from "../src/routes/me";
import { sendEmail } from "../src/services/email";
import { sendNotifyEmail } from "../src/services/notify/email-notify";
import type { Env } from "../src/types";
import {
  cookieHeader,
  MockKV,
  makeToken,
  request,
  seedSession,
} from "./helpers";
import { setConnectFactory } from "./stubs/sockets";

// In-memory duplex socket mock for SMTP protocol exchanges
class FakeSmtpServer {
  commands: string[] = [];
  connectCalls: { address: unknown; options: unknown }[] = [];
  message = "";

  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
      this.push("220 fake.smtp.example ESMTP");
    },
  });
  private lineBuf = "";
  private inData = false;
  private pending: "user" | "pass" | null = null;

  socket() {
    const self = this;
    return {
      readable: this.stream,
      writable: new WritableStream<Uint8Array>({
        write(chunk) {
          self.handleChunk(new TextDecoder().decode(chunk));
        },
      }),
      startTls() {
        return self.socket();
      },
      close: async () => {
        try {
          self.controller.close();
        } catch {}
      },
    };
  }

  install(): void {
    setConnectFactory((address, options) => {
      this.connectCalls.push({ address, options });
      return this.socket();
    });
  }

  private push(line: string): void {
    this.controller.enqueue(new TextEncoder().encode(`${line}\r\n`));
  }

  private handleChunk(text: string): void {
    this.lineBuf += text;
    let idx = this.lineBuf.indexOf("\r\n");
    while (idx >= 0) {
      const line = this.lineBuf.slice(0, idx);
      this.lineBuf = this.lineBuf.slice(idx + 2);
      this.onLine(line);
      idx = this.lineBuf.indexOf("\r\n");
    }
  }

  private onLine(line: string): void {
    if (this.inData) {
      if (line === ".") {
        this.inData = false;
        this.push("250 2.0.0 ok queued");
      } else {
        this.message += `${line}\r\n`;
      }
      return;
    }

    if (this.pending === "user") {
      this.pending = "pass";
      this.push("334 UGFzc3dvcmQ6");
      return;
    }
    if (this.pending === "pass") {
      this.pending = null;
      this.push("235 2.7.0 ok");
      return;
    }

    this.commands.push(line);
    const upper = line.toUpperCase();
    if (upper.startsWith("EHLO")) {
      this.push("250-fake.smtp.example");
      this.push("250 STARTTLS");
      return;
    }
    if (upper === "STARTTLS") {
      this.push("220 2.0.0 Ready to start TLS");
      return;
    }
    if (upper === "AUTH LOGIN") {
      this.pending = "user";
      this.push("334 VXNlcm5hbWU6");
      return;
    }
    if (upper.startsWith("MAIL FROM")) {
      this.push("250 2.1.0 ok");
      return;
    }
    if (upper.startsWith("RCPT TO")) {
      this.push("250 2.1.5 ok");
      return;
    }
    if (upper === "DATA") {
      this.inData = true;
      this.push("354 go ahead");
      return;
    }
    if (upper === "QUIT") {
      this.push("221 bye");
      return;
    }
    this.push("500 unrecognized");
  }
}

// Multi-table in-memory mock supporting settings, notification_configs, and notification_history
class FullMockD1 {
  settings = new Map<string, string>();
  notificationConfigs = new Map<string, Record<string, any>>();
  historyRows: Record<string, any>[] = [];

  prepare(sql: string) {
    const s = sql.replace(/\s+/g, " ").trim();

    // Settings queries
    if (/SELECT value FROM .*settings WHERE key = \?/i.test(s)) {
      return {
        bind: (key: string) => ({
          first: async () =>
            this.settings.has(key) ? { value: this.settings.get(key) } : null,
        }),
      };
    }
    if (/INSERT INTO .*settings/i.test(s)) {
      return {
        bind: (key: string, val: string) => ({
          run: async () => {
            this.settings.set(key, val);
            return { success: true };
          },
        }),
      };
    }

    // Notification configs queries
    if (/SELECT \* FROM .*notification_configs WHERE user_id = \?/i.test(s)) {
      return {
        bind: (userId: string) => ({
          first: async () => this.notificationConfigs.get(userId) ?? null,
        }),
      };
    }
    if (/INSERT INTO .*notification_configs/i.test(s)) {
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
            this.notificationConfigs.set(userId, row);
            return { success: true };
          },
        }),
      };
    }

    // Notification history queries
    if (/INSERT INTO .*notification_history/i.test(s)) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.historyRows.push({
              id: args[0],
              user_id: args[1],
              item_id: args[2],
              channel: args[3],
              title: args[4],
              body: args[5],
              success: args[6],
              error: args[7],
              created_at: args[8],
            });
            return { success: true };
          },
        }),
      };
    }

    if (/SELECT \* FROM .*notification_history WHERE user_id = \?/i.test(s)) {
      return {
        bind: (userId: string, limit: number) => ({
          all: async () => ({
            results: this.historyRows
              .filter((r) => r.user_id === userId)
              .slice(0, limit),
          }),
        }),
      };
    }

    throw new Error(`FullMockD1: unsupported query: ${s}`);
  }
}

afterEach(() => {
  setConnectFactory(undefined);
});

describe("End-to-End Mail Separation: System Mail vs Notification Mail", () => {
  it("Path 1: System mail strictly uses settings table global configuration", async () => {
    const db = new FullMockD1();
    db.settings.set("email_provider", "smtp");
    db.settings.set(
      "smtp_config",
      JSON.stringify({
        host: "global-system-smtp.example.com",
        port: 465,
        username: "system-admin@example.com",
        password: "global-smtp-pass",
        from: "noreply@example.com",
        from_name: "eNotify System",
      }),
    );

    const server = new FakeSmtpServer();
    server.install();

    const env = { DB: db } as unknown as Env;

    const res = await sendEmail(env, {
      to: "recipient@example.com",
      subject: "Your verification code",
      html: "<p>Code: 123456</p>",
    });

    expect(res).toEqual({ success: true });
    expect(server.connectCalls[0].address).toEqual({
      hostname: "global-system-smtp.example.com",
      port: 465,
    });
    expect(server.connectCalls[0].options).toEqual({ secureTransport: "on" });
    expect(server.message).toContain(
      "From: eNotify System <noreply@example.com>",
    );
    expect(server.message).toContain("To: recipient@example.com");
  });

  it("Path 1: System mail returns error when provider is 'none' or unconfigured", async () => {
    const db = new FullMockD1();
    db.settings.set("email_provider", "none");
    const env = { DB: db } as unknown as Env;

    const res = await sendEmail(env, {
      to: "recipient@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });

    expect(res).toEqual({
      success: false,
      error: "No email provider configured",
    });
  });

  it("Path 2: Notification channel strictly uses user's own SMTP and does not fall back to global settings", async () => {
    const db = new FullMockD1();
    // Configure global system mail with a distinct host
    db.settings.set("email_provider", "smtp");
    db.settings.set(
      "smtp_config",
      JSON.stringify({
        host: "global-system-smtp.example.com",
        port: 465,
        username: "system-admin@example.com",
        password: "global-smtp-pass",
      }),
    );

    const userConfig = JSON.stringify({
      to: "notify-dest@example.com",
      smtp_host: "user-private-smtp.example.com",
      smtp_port: "587",
      smtp_username: "user@example.com",
      smtp_password: "user-secret",
      smtp_from: "user-from@example.com",
      from_name: "My Custom Bot",
    });

    const server = new FakeSmtpServer();
    server.install();

    const env = { DB: db } as unknown as Env;

    const res = await sendNotifyEmail(
      userConfig,
      { title: "Task Expiring", body: "Your item expires soon." },
      env,
    );

    expect(res).toEqual({ success: true });
    // Must connect to the USER's SMTP, NOT the global SMTP!
    expect(server.connectCalls[0].address).toEqual({
      hostname: "user-private-smtp.example.com",
      port: 587,
    });
    expect(server.message).toContain(
      "From: My Custom Bot <user-from@example.com>",
    );
    expect(server.message).toContain("To: notify-dest@example.com");
  });

  it("Path 2: Notification channel with empty smtp_host returns error and does NOT fall back to global SMTP", async () => {
    const db = new FullMockD1();
    db.settings.set("email_provider", "smtp");
    db.settings.set(
      "smtp_config",
      JSON.stringify({
        host: "global-system-smtp.example.com",
        port: 465,
      }),
    );

    const userConfigWithoutHost = JSON.stringify({
      to: "notify-dest@example.com",
      smtp_host: "",
      smtp_port: "465",
    });

    const server = new FakeSmtpServer();
    server.install();

    const env = { DB: db } as unknown as Env;

    const res = await sendNotifyEmail(
      userConfigWithoutHost,
      { title: "Task Expiring", body: "Your item expires soon." },
      env,
    );

    expect(res).toEqual({
      success: false,
      error: "Email channel SMTP not configured",
    });
    // Absolutely NO socket connect call should have occurred!
    expect(server.connectCalls).toHaveLength(0);
  });

  it("Path 2 API & History: POST /api/me/notifications/test logs failure when smtp_host is missing", async () => {
    const db = new FullMockD1();
    // System mail configured globally
    db.settings.set("email_provider", "smtp");
    db.settings.set(
      "smtp_config",
      JSON.stringify({ host: "global.example.com", port: 465 }),
    );

    // User config with missing smtp_host
    db.notificationConfigs.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["email"]),
      email_config: JSON.stringify({
        to: "alert@example.com",
        smtp_host: "",
      }),
    });

    const app = new Hono();
    app.route("/api/me", meRoutes);

    const env = {
      DB: db,
      KV: new MockKV(),
      JWT_SECRET: "test-jwt-secret-0123456789abcdef",
      TABLE_PREFIX: "",
    };
    await seedSession(env, "user-1", "session-1");
    const token = await makeToken("user", { sub: "user-1", sid: "session-1" });

    const server = new FakeSmtpServer();
    server.install();

    const res = await request(app, env, "/api/me/notifications/test", {
      method: "POST",
      headers: { ...cookieHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "email" }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      error: "Email channel SMTP not configured",
    });

    // Verify history recorded failure without falling back
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0].channel).toBe("email");
    expect(db.historyRows[0].success).toBe(0);
    expect(db.historyRows[0].error).toBe("Email channel SMTP not configured");
    expect(server.connectCalls).toHaveLength(0);
  });

  it("Path 2 API & History: POST /api/me/notifications/test sends via user SMTP and logs success", async () => {
    const db = new FullMockD1();
    db.notificationConfigs.set("user-1", {
      user_id: "user-1",
      enabled_channels: JSON.stringify(["email"]),
      email_config: JSON.stringify({
        to: "alert@example.com",
        smtp_host: "smtp.user-domain.com",
        smtp_port: "465",
        smtp_username: "user@user-domain.com",
        smtp_password: "user-password",
        smtp_from: "alerts@user-domain.com",
      }),
    });

    const app = new Hono();
    app.route("/api/me", meRoutes);

    const env = {
      DB: db,
      KV: new MockKV(),
      JWT_SECRET: "test-jwt-secret-0123456789abcdef",
      TABLE_PREFIX: "",
    };
    await seedSession(env, "user-1", "session-1");
    const token = await makeToken("user", { sub: "user-1", sid: "session-1" });

    const server = new FakeSmtpServer();
    server.install();

    const res = await request(app, env, "/api/me/notifications/test", {
      method: "POST",
      headers: { ...cookieHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "email" }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(server.connectCalls[0].address).toEqual({
      hostname: "smtp.user-domain.com",
      port: 465,
    });
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0].channel).toBe("email");
    expect(db.historyRows[0].success).toBe(1);
  });

  it("Path 1 vs Path 2 Admin test: POST /api/admin/system/settings/test-email uses global settings", async () => {
    const db = new FullMockD1();
    db.settings.set("email_provider", "smtp");
    db.settings.set(
      "smtp_config",
      JSON.stringify({
        host: "admin-global-smtp.example.com",
        port: 465,
        username: "admin@example.com",
        password: "admin-password",
        from: "admin-system@example.com",
      }),
    );

    const app = new Hono();
    app.route("/api/admin", adminRoutes);

    const env = {
      DB: db,
      KV: new MockKV(),
      JWT_SECRET: "test-jwt-secret-0123456789abcdef",
      TABLE_PREFIX: "",
    };
    await seedSession(env, "admin-1", "session-admin");
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "session-admin",
    });

    const server = new FakeSmtpServer();
    server.install();

    const res = await request(
      app,
      env,
      "/api/admin/system/settings/test-email",
      {
        method: "POST",
        headers: { ...cookieHeader(token), "Content-Type": "application/json" },
        body: JSON.stringify({ to: "admin-verify@example.com" }),
      },
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(server.connectCalls[0].address).toEqual({
      hostname: "admin-global-smtp.example.com",
      port: 465,
    });
    expect(server.message).toContain(
      "From: eNotify <admin-system@example.com>",
    );
  });
});

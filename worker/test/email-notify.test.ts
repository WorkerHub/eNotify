import { afterEach, describe, expect, it } from "vitest";
import { sendNotifyEmail } from "../src/services/notify/email-notify";
import { sendNotifications } from "../src/services/notify/index";
import type { Env } from "../src/types";
import { setConnectFactory } from "./stubs/sockets";

// ─── Fake SMTP server over an in-memory duplex socket ────────────────────────

interface FakeOptions {
  supportsStartTls?: boolean;
  rejectAuth?: boolean;
  rejectRecipient?: boolean;
}

class FakeSmtpServer {
  commands: string[] = [];
  connectCalls: { address: unknown; options: unknown }[] = [];
  message = "";
  startTlsUsed = false;
  authSeen: { user?: string; pass?: string; afterTls: boolean } | null = null;

  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
      this.push("220 fake.example.com ESMTP");
    },
  });
  private lineBuf = "";
  private inData = false;
  private pending: "user" | "pass" | null = null;

  constructor(private readonly opts: FakeOptions = {}) {}

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
        self.startTlsUsed = true;
        return self.socket();
      },
      close: async () => {
        try {
          self.controller.close();
        } catch {
          /* already closed */
        }
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
        this.push("250 2.0.0 queued");
      } else {
        this.message += `${line}\r\n`;
      }
      return;
    }

    if (this.pending === "user") {
      this.authSeen = {
        ...this.authSeen,
        user: Buffer.from(line, "base64").toString("utf8"),
        afterTls: this.startTlsUsed,
      };
      this.pending = "pass";
      this.push("334 UGFzc3dvcmQ6");
      return;
    }
    if (this.pending === "pass") {
      if (this.authSeen) {
        this.authSeen.pass = Buffer.from(line, "base64").toString("utf8");
        this.authSeen.afterTls = this.startTlsUsed;
      }
      this.pending = null;
      this.push(this.opts.rejectAuth ? "535 auth failed" : "235 2.7.0 ok");
      return;
    }

    this.commands.push(line);
    const upper = line.toUpperCase();

    if (upper.startsWith("EHLO")) {
      if (this.opts.supportsStartTls === false) {
        this.push("250 fake.example.com");
      } else {
        this.push("250-fake.example.com");
        this.push("250 STARTTLS");
      }
      return;
    }
    if (upper === "STARTTLS") {
      this.push(
        this.opts.supportsStartTls === false
          ? "500 5.5.1 unknown"
          : "220 go ahead",
      );
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
      this.push(
        this.opts.rejectRecipient ? "550 5.1.1 no such user" : "250 2.1.5 ok",
      );
      return;
    }
    if (upper === "DATA") {
      this.inData = true;
      this.push("354 end with <CRLF>.<CRLF>");
      return;
    }
    if (upper === "QUIT") {
      this.push("221 bye");
      return;
    }
    this.push("500 5.5.1 unrecognized");
  }
}

/** Env whose DB throws on any access — proves no global settings are read. */
function makeEnvWithoutSettings(): Env {
  return Object.defineProperty({}, "DB", {
    get() {
      throw new Error("settings table must not be read by the email channel");
    },
  }) as Env;
}

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    to: "user@example.com",
    smtp_host: "smtp.example.com",
    smtp_port: "587",
    smtp_username: "login@example.com",
    smtp_password: "s3cret-pass",
    smtp_from: "notify@example.com",
    ...overrides,
  });
}

const MESSAGE = { title: "Renewal due", body: "Your plan expires soon." };

afterEach(() => {
  setConnectFactory(undefined);
});

describe("sendNotifyEmail", () => {
  it("fails without SMTP host configured and does not fall back to system mail", async () => {
    const result = await sendNotifyEmail(
      JSON.stringify({ to: "user@example.com" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Email channel SMTP not configured");
  });

  it("still requires a valid recipient address", async () => {
    const env = makeEnvWithoutSettings();

    await expect(sendNotifyEmail("{}", MESSAGE, env)).resolves.toEqual({
      success: false,
      error: "Email recipient required",
    });
    await expect(
      sendNotifyEmail(config({ to: "a@b.com,c@d.com" }), MESSAGE, env),
    ).resolves.toEqual({ success: false, error: "Invalid email recipient" });
    await expect(
      sendNotifyEmail(config({ to: "not-an-email" }), MESSAGE, env),
    ).resolves.toEqual({
      success: false,
      error: "Invalid recipient email address",
    });
  });

  it("rejects an unusable smtp_port instead of guessing one", async () => {
    const env = makeEnvWithoutSettings();
    for (const port of ["", "abc", "0", "70000"]) {
      const result = await sendNotifyEmail(
        config({ smtp_port: port }),
        MESSAGE,
        env,
      );
      expect(result).toEqual({
        success: false,
        error: "Invalid Email channel SMTP port",
      });
    }
  });

  it("rejects a smtp_host that is not a plain hostname/IP", async () => {
    const env = makeEnvWithoutSettings();
    for (const host of [
      "smtp.example.com\r\nX-Injected: 1",
      "smtp.example.com/evil",
      "user@smtp.example.com",
      "smtp example com",
      "smtp.example.com;evil",
    ]) {
      const result = await sendNotifyEmail(
        config({ smtp_host: host }),
        MESSAGE,
        env,
      );
      expect(result).toEqual({
        success: false,
        error: "Invalid Email channel SMTP host",
      });
    }
  });

  it("accepts a plain hostname, an IPv4 address and a bracketed IPv6 address", async () => {
    const env = makeEnvWithoutSettings();
    for (const host of ["smtp.example.com", "192.0.2.10", "[2001:db8::1]"]) {
      const server = new FakeSmtpServer();
      server.install();
      const result = await sendNotifyEmail(
        config({ smtp_host: host }),
        MESSAGE,
        env,
      );
      expect(result).toEqual({ success: true });
      expect(server.connectCalls[0].address).toMatchObject({ hostname: host });
    }
  });

  it("rejects a sender address that would inject headers or is malformed", async () => {
    const env = makeEnvWithoutSettings();
    for (const from of [
      "notify@example.com\r\nBcc: victim@example.com",
      "notify@example.com,eve@example.com",
      "notify@example.com>",
      "not-an-email",
    ]) {
      const server = new FakeSmtpServer();
      server.install();
      const result = await sendNotifyEmail(
        config({ smtp_from: from }),
        MESSAGE,
        env,
      );
      expect(result).toEqual({
        success: false,
        error: "Invalid Email channel SMTP sender address",
      });
      // Nothing was ever sent, not even a connection attempt.
      expect(server.connectCalls).toHaveLength(0);
      expect(server.commands).toHaveLength(0);
    }
  });

  it("rejects an injection attempt that comes in through smtp_username", async () => {
    const env = makeEnvWithoutSettings();
    const result = await sendNotifyEmail(
      config({
        smtp_from: "",
        smtp_username: "login@example.com\r\nBcc: victim@example.com",
      }),
      MESSAGE,
      env,
    );
    expect(result).toEqual({
      success: false,
      error: "Invalid Email channel SMTP sender address",
    });
  });

  it("falls back to smtp_username as the sender when smtp_from is empty", async () => {
    const server = new FakeSmtpServer();
    server.install();

    const result = await sendNotifyEmail(
      config({ smtp_from: "" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result).toEqual({ success: true });
    expect(server.commands).toContain("MAIL FROM:<login@example.com>");
    expect(server.message).toContain("From: eNotify <login@example.com>");
  });

  it("does not throw on non-string config values", async () => {
    const env = makeEnvWithoutSettings();
    await expect(
      sendNotifyEmail(config({ to: 12345 }), MESSAGE, env),
    ).resolves.toEqual({
      success: false,
      error: "Invalid recipient email address",
    });
    await expect(
      sendNotifyEmail(config({ smtp_host: null }), MESSAGE, env),
    ).resolves.toEqual({
      success: false,
      error: "Email channel SMTP not configured",
    });
  });

  it("uses implicit TLS on port 465 and authenticates in the TLS session", async () => {
    const server = new FakeSmtpServer();
    server.install();

    const result = await sendNotifyEmail(
      config({ smtp_port: "465" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result).toEqual({ success: true });
    expect(server.connectCalls[0].address).toEqual({
      hostname: "smtp.example.com",
      port: 465,
    });
    expect(server.connectCalls[0].options).toEqual({ secureTransport: "on" });
    expect(server.commands.some((c) => c.toUpperCase() === "STARTTLS")).toBe(
      false,
    );
    expect(server.authSeen?.user).toBe("login@example.com");
    expect(server.authSeen?.pass).toBe("s3cret-pass");
    expect(server.message).toContain("From: eNotify <notify@example.com>");
    expect(server.message).toContain("To: user@example.com");
    expect(server.commands).toContain("MAIL FROM:<notify@example.com>");
    expect(server.commands).toContain("RCPT TO:<user@example.com>");
  });

  it("converts the string port to a number and negotiates STARTTLS otherwise", async () => {
    const server = new FakeSmtpServer();
    server.install();

    const result = await sendNotifyEmail(
      config({ smtp_port: "587" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result).toEqual({ success: true });
    expect(server.connectCalls[0].address).toEqual({
      hostname: "smtp.example.com",
      port: 587,
    });
    expect(server.connectCalls[0].options).toEqual({
      secureTransport: "starttls",
    });
    expect(server.startTlsUsed).toBe(true);
    expect(
      server.commands.filter((c) => c.toUpperCase().startsWith("EHLO")),
    ).toHaveLength(2);
    expect(server.authSeen?.afterTls).toBe(true);
  });

  it("refuses to send credentials in plaintext when STARTTLS is unsupported", async () => {
    const server = new FakeSmtpServer({ supportsStartTls: false });
    server.install();

    const result = await sendNotifyEmail(
      config(),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("refusing to send credentials in plaintext");
    expect(server.commands).not.toContain("AUTH LOGIN");
    expect(server.message).toBe("");
  });

  it("sends without authentication when only a sender is configured", async () => {
    const server = new FakeSmtpServer({ supportsStartTls: false });
    server.install();

    const result = await sendNotifyEmail(
      config({ smtp_username: "", smtp_password: "" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result).toEqual({ success: true });
    expect(server.commands).not.toContain("AUTH LOGIN");
    expect(server.commands).toContain("MAIL FROM:<notify@example.com>");
  });

  it("refuses to send when no sender can be derived from the config", async () => {
    const result = await sendNotifyEmail(
      config({ smtp_username: "", smtp_from: "" }),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result).toEqual({
      success: false,
      error:
        "Invalid Email channel SMTP sender (set smtp_from or smtp_username)",
    });
  });

  it("surfaces SMTP server rejections as errors", async () => {
    const server = new FakeSmtpServer({ rejectRecipient: true });
    server.install();

    const result = await sendNotifyEmail(
      config(),
      MESSAGE,
      makeEnvWithoutSettings(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP error");
  });

  it("records the failure in notification history without falling back", async () => {
    const inserts: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (sql.includes("notification_history")) inserts.push(args);
            return { success: true };
          },
        }),
      }),
    };

    const results = await sendNotifications(
      {
        user_id: "user-1",
        enabled_channels: JSON.stringify(["email"]),
        email_config: JSON.stringify({ to: "user@example.com" }),
      } as any,
      MESSAGE,
      { DB: db } as unknown as Env,
      {
        db: db as unknown as D1Database,
        prefix: "",
        userId: "user-1",
        itemId: "item-1",
      },
    );

    expect(results).toEqual([
      {
        channel: "email",
        success: false,
        error: "Email channel SMTP not configured",
      },
    ]);
    expect(inserts).toHaveLength(1);
    // (id, user_id, item_id, channel, title, body, success, error, created_at)
    expect(inserts[0][3]).toBe("email");
    expect(inserts[0][6]).toBe(0);
    expect(String(inserts[0][7])).toMatch(/SMTP not configured/);
  });
});

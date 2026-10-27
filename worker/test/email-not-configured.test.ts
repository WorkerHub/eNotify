/**
 * ONE-461 / ONE-466 — email delivery not configured.
 *
 * Covers the single source of truth (`isEmailConfigured`), the public signal on
 * `/api/system/info`, the 2FA login filtering + fail-closed guard, the OTP
 * send/verify guards, the forgot-password guard, and the settings-side guards.
 *
 * Runs against the real worker app (`src/index.ts`) on a real in-memory SQLite
 * database seeded from `src/db/schema.sql`, so the SQL under test is the SQL
 * that ships.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/core/auth";
import { isEmailConfigured } from "../src/services/email";
import type { Env } from "../src/types";
import { type MockKV, makeToken } from "./helpers";
import {
  type BackupResponse,
  type BackupTestEnv,
  SqliteD1,
  callWorker,
  jsonPost,
  makeBackupEnv,
} from "./support/backup";

const NOW = "2026-10-26T10:00:00.000Z";
const PASSWORD = "correct-horse-battery";

// ─── helpers ─────────────────────────────────────────────────────────────────

let ipSeq = 0;

/** Fresh budget per request: the rate limiter keys on the client IP. */
function nextIp(): string {
  ipSeq += 1;
  return `10.${Math.floor(ipSeq / 250)}.0.${ipSeq % 250}`;
}

function makeDb(settings: Record<string, string> = {}): SqliteD1 {
  const db = new SqliteD1();
  for (const [key, value] of Object.entries(settings)) {
    db.insert("system_settings", { key, value, updated_at: NOW });
  }
  return db;
}

const EMAIL_UNCONFIGURED = { email_provider: "none" };
const EMAIL_CONFIGURED = {
  email_provider: "resend",
  resend_config: JSON.stringify({ api_key: "re_test_key" }),
};

interface SeedUserOptions {
  id: string;
  email: string;
  totp?: boolean;
  passkey?: boolean;
  emailOtp?: boolean;
}

async function seedUser(
  db: SqliteD1,
  opts: SeedUserOptions,
): Promise<{ passwordHash: string }> {
  const passwordHash = await hashPassword(PASSWORD);
  db.insert("users", {
    id: opts.id,
    email: opts.email,
    password_hash: passwordHash,
    role: "user",
    is_active: 1,
    email_verified: 1,
    language: "en",
    created_at: NOW,
    updated_at: NOW,
  });
  if (opts.totp || opts.passkey || opts.emailOtp) {
    db.insert("user_2fa", {
      user_id: opts.id,
      totp_secret: opts.totp ? "JBSWY3DPEHPK3PXP" : null,
      totp_enabled: opts.totp ? 1 : 0,
      passkey_credentials: null,
      passkey_enabled: opts.passkey ? 1 : 0,
      email_otp_enabled: opts.emailOtp ? 1 : 0,
      preferred_method: null,
      updated_at: NOW,
    });
  }
  return { passwordHash };
}

function kvOf(env: BackupTestEnv): MockKV {
  return env.KV as MockKV;
}

function kvKeysWith(env: BackupTestEnv, prefix: string): string[] {
  return [...kvOf(env).store.keys()].filter((key) => key.startsWith(prefix));
}

function emailOtpEnabled(db: SqliteD1, userId: string): number | null {
  const rows = db.select<{ email_otp_enabled: number }>(
    "SELECT email_otp_enabled FROM user_2fa WHERE user_id = ?",
    userId,
  );
  return rows.length > 0 ? rows[0].email_otp_enabled : null;
}

/** `Headers.getSetCookie()` is available on Node 22+; fall back to the raw value. */
function setCookies(res: BackupResponse): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = res.headers.get("set-cookie");
  return raw ? [raw] : [];
}

function post(
  env: BackupTestEnv,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<BackupResponse> {
  return callWorker(
    env,
    path,
    jsonPost(body, { "cf-connecting-ip": nextIp(), ...headers }),
  );
}

function authedPost(
  env: BackupTestEnv,
  path: string,
  token: string,
  body: unknown,
): Promise<BackupResponse> {
  return post(env, path, body, { Cookie: `access_token=${token}` });
}

async function authedToken(
  env: BackupTestEnv,
  userId: string,
  sid = "session-test-1",
): Promise<string> {
  kvOf(env).store.set(`ss:${sid}`, userId);
  return makeToken("user", { sub: userId, sid });
}

/** Resend is the configured provider in the positive cases; never hit the network. */
function stubOutboundEmail(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── §2 single source of truth ───────────────────────────────────────────────

describe("isEmailConfigured (§2)", () => {
  async function configured(
    settings: Record<string, string>,
  ): Promise<boolean> {
    const env = makeBackupEnv(makeDb(settings));
    return isEmailConfigured(env as unknown as Env);
  }

  it("is false when email_provider is unset", async () => {
    expect(await configured({})).toBe(false);
  });

  it("is false when email_provider is none", async () => {
    expect(await configured({ email_provider: "none" })).toBe(false);
  });

  it("resend without resend_config / api_key is false", async () => {
    expect(await configured({ email_provider: "resend" })).toBe(false);
    expect(
      await configured({ email_provider: "resend", resend_config: "{}" }),
    ).toBe(false);
    expect(
      await configured({
        email_provider: "resend",
        resend_config: JSON.stringify({ api_key: "" }),
      }),
    ).toBe(false);
  });

  it("resend with an api_key is true", async () => {
    expect(
      await configured({
        email_provider: "resend",
        resend_config: JSON.stringify({ api_key: "re_live" }),
      }),
    ).toBe(true);
  });

  it("smtp without smtp_config / host is false", async () => {
    expect(await configured({ email_provider: "smtp" })).toBe(false);
    expect(
      await configured({ email_provider: "smtp", smtp_config: "{}" }),
    ).toBe(false);
    expect(
      await configured({
        email_provider: "smtp",
        smtp_config: JSON.stringify({ host: "" }),
      }),
    ).toBe(false);
  });

  it("smtp with a host is true", async () => {
    expect(
      await configured({
        email_provider: "smtp",
        smtp_config: JSON.stringify({ host: "smtp.example.com", port: 587 }),
      }),
    ).toBe(true);
  });

  it("is false (and does not throw) for broken config JSON", async () => {
    expect(
      await configured({
        email_provider: "resend",
        resend_config: '{"api_key": ',
      }),
    ).toBe(false);
    expect(
      await configured({
        email_provider: "smtp",
        smtp_config: "not json at all",
      }),
    ).toBe(false);
  });

  it("is false for an unknown provider", async () => {
    expect(
      await configured({
        email_provider: "postmark",
        resend_config: JSON.stringify({ api_key: "re_live" }),
      }),
    ).toBe(false);
  });
});

// ─── §3.1 public signal ──────────────────────────────────────────────────────

describe("GET /api/system/info (§3.1)", () => {
  it("reports email_configured: true when email delivery works", async () => {
    const env = makeBackupEnv(makeDb(EMAIL_CONFIGURED));
    const res = await callWorker(env, "/api/system/info");

    expect(res.status).toBe(200);
    expect(res.body.email_configured).toBe(true);
  });

  it("reports email_configured: false and leaks no provider/config detail", async () => {
    const env = makeBackupEnv(makeDb(EMAIL_UNCONFIGURED));
    const res = await callWorker(env, "/api/system/info");

    expect(res.status).toBe(200);
    expect(res.body.email_configured).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual([
      "app_name",
      "email_configured",
      "registration_enabled",
      "version",
    ]);
    expect(res.text).not.toMatch(/provider|smtp|resend|api_key/i);
  });

  it("fails closed when the settings read throws", async () => {
    const env = makeBackupEnv(makeDb(EMAIL_CONFIGURED), {
      DB: {
        prepare() {
          throw new Error("D1 unavailable");
        },
      },
    });
    const res = await callWorker(env, "/api/system/info");

    expect(res.status).toBe(200);
    expect(res.body.email_configured).toBe(false);
  });
});

// ─── §3.2 login filtering ────────────────────────────────────────────────────

describe("POST /auth/login 2FA filtering (§3.2)", () => {
  it("drops email_otp from availableMethods when email is not configured", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-both",
      email: "both@example.com",
      totp: true,
      emailOtp: true,
    });
    const env = makeBackupEnv(db);

    const res = await post(env, "/api/auth/login", {
      email: "both@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.availableMethods).toEqual(["totp"]);
    expect(kvKeysWith(env, "2fa:")).toEqual([`2fa:${res.body.tempToken}`]);
  });

  it("offers both methods when email is configured", async () => {
    const db = makeDb(EMAIL_CONFIGURED);
    await seedUser(db, {
      id: "u-both",
      email: "both@example.com",
      totp: true,
      emailOtp: true,
    });
    const env = makeBackupEnv(db);

    const res = await post(env, "/api/auth/login", {
      email: "both@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.availableMethods).toEqual(["totp", "email_otp"]);
  });
});

// ─── §3.3 fail closed when the only enabled method is unavailable ────────────

describe("POST /auth/login fail-closed (§3.3)", () => {
  it("rejects with 403 2FA_METHOD_UNAVAILABLE and issues no token", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-emailonly",
      email: "emailonly@example.com",
      emailOtp: true,
    });
    const env = makeBackupEnv(db);

    const res = await post(env, "/api/auth/login", {
      email: "emailonly@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("2FA_METHOD_UNAVAILABLE");
    expect(res.body.error).toMatch(/two-factor/i);
    expect(res.body.tempToken).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    expect(res.body.success).toBeUndefined();

    const cookies = setCookies(res);
    expect(cookies.filter((c) => /access_token|refresh_token/.test(c))).toEqual(
      [],
    );

    // Nothing was opened: no tempToken, no session.
    expect(kvKeysWith(env, "2fa:")).toEqual([]);
    expect(kvKeysWith(env, "ss:")).toEqual([]);
    expect(kvKeysWith(env, "rt:")).toEqual([]);
  });

  it("still walks requires2fa when email is configured", async () => {
    const db = makeDb(EMAIL_CONFIGURED);
    await seedUser(db, {
      id: "u-emailonly",
      email: "emailonly@example.com",
      emailOtp: true,
    });
    const env = makeBackupEnv(db);

    const res = await post(env, "/api/auth/login", {
      email: "emailonly@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.requires2fa).toBe(true);
    expect(res.body.availableMethods).toEqual(["email_otp"]);
    expect(kvOf(env).store.get(`2fa:${res.body.tempToken}`)).toBe(
      "u-emailonly",
    );
  });

  it("leaves the needs2faSetup flow of never-enrolled users untouched", async () => {
    const db = makeDb({ ...EMAIL_UNCONFIGURED, require_2fa: "true" });
    await seedUser(db, { id: "u-fresh", email: "fresh@example.com" });
    const env = makeBackupEnv(db);

    const res = await post(env, "/api/auth/login", {
      email: "fresh@example.com",
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.needs2faSetup).toBe(true);
  });
});

// ─── §3.4 OTP send / verify guards ───────────────────────────────────────────

describe("2FA email OTP endpoints (§3.4)", () => {
  it("POST /auth/2fa/otp/send is refused before generating a code", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-2fa",
      email: "2fa@example.com",
      totp: true,
      emailOtp: true,
    });
    const env = makeBackupEnv(db);
    kvOf(env).store.set("2fa:temp-1", "u-2fa");

    const res = await post(env, "/api/auth/2fa/otp/send", {
      tempToken: "temp-1",
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(kvKeysWith(env, "otp:")).toEqual([]);
  });

  it("POST /auth/2fa/verify rejects email_otp when email is not configured", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-2fa",
      email: "2fa@example.com",
      totp: true,
      emailOtp: true,
    });
    const env = makeBackupEnv(db);
    kvOf(env).store.set("2fa:temp-1", "u-2fa");

    const res = await post(env, "/api/auth/2fa/verify", {
      tempToken: "temp-1",
      method: "email_otp",
      code: "123456",
    });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("EMAIL_NOT_CONFIGURED");
    // The temp session was not consumed and no session was created.
    expect(kvOf(env).store.get("2fa:temp-1")).toBe("u-2fa");
    expect(kvKeysWith(env, "ss:")).toEqual([]);
  });

  it("POST /auth/2fa/verify leaves totp unguarded", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-2fa",
      email: "2fa@example.com",
      totp: true,
    });
    const env = makeBackupEnv(db);
    kvOf(env).store.set("2fa:temp-1", "u-2fa");

    const res = await post(env, "/api/auth/2fa/verify", {
      tempToken: "temp-1",
      method: "totp",
      code: "000000",
    });

    // Wrong code, but the email guard did not fire: the totp path still runs.
    expect(res.status).toBe(401);
    expect(res.body.code).toBeUndefined();
  });

  it("still sends and verifies email codes when email is configured", async () => {
    stubOutboundEmail();
    const db = makeDb(EMAIL_CONFIGURED);
    await seedUser(db, {
      id: "u-2fa",
      email: "2fa@example.com",
      emailOtp: true,
    });
    const env = makeBackupEnv(db);
    kvOf(env).store.set("2fa:temp-1", "u-2fa");

    const sent = await post(env, "/api/auth/2fa/otp/send", {
      tempToken: "temp-1",
    });
    expect(sent.status).toBe(200);

    const code = kvOf(env).store.get("otp:u-2fa:temp-1");
    expect(code).toMatch(/^\d{6}$/);

    const verified = await post(env, "/api/auth/2fa/verify", {
      tempToken: "temp-1",
      method: "email_otp",
      code,
    });
    expect(verified.status).toBe(200);
    expect(verified.body.success).toBe(true);
  });
});

// ─── §3.5 forgot password ────────────────────────────────────────────────────

describe("POST /auth/password/forgot (§3.5)", () => {
  it("answers identically for registered and unknown emails, writing nothing", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, { id: "u-known", email: "known@example.com" });
    const env = makeBackupEnv(db);

    const known = await post(env, "/api/auth/password/forgot", {
      email: "known@example.com",
    });
    const unknown = await post(env, "/api/auth/password/forgot", {
      email: "nobody@example.com",
    });

    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(known.body.error).toMatch(/not configured/i);

    // No reset code, no cooldown, no failure counter — nothing at all.
    expect(kvKeysWith(env, "pwd_reset")).toEqual([]);
    expect(kvKeysWith(env, "otp:")).toEqual([]);
  });

  it("keeps the existing anti-enumeration behaviour when email is configured", async () => {
    stubOutboundEmail();
    const db = makeDb(EMAIL_CONFIGURED);
    await seedUser(db, { id: "u-known", email: "known@example.com" });
    const env = makeBackupEnv(db);

    const known = await post(env, "/api/auth/password/forgot", {
      email: "known@example.com",
    });
    const unknown = await post(env, "/api/auth/password/forgot", {
      email: "nobody@example.com",
    });

    expect(known.status).toBe(200);
    expect(known.body).toEqual({ success: true });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ success: true });
    expect(kvOf(env).store.get("pwd_reset:u-known")).toMatch(/^\d{6}$/);
    expect(kvKeysWith(env, "pwd_reset:u-")).toEqual(["pwd_reset:u-known"]);
  });
});

// ─── §3.6 settings-side guards ───────────────────────────────────────────────

describe("email OTP settings endpoints (§3.6)", () => {
  it("refuses send-verify and enable when email is not configured", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-settings",
      email: "settings@example.com",
      totp: true,
    });
    const env = makeBackupEnv(db);
    const token = await authedToken(env, "u-settings");

    const send = await authedPost(
      env,
      "/api/auth/2fa/email-otp/send-verify",
      token,
      {},
    );
    expect(send.status).toBe(503);
    expect(send.body.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(kvKeysWith(env, "otp:")).toEqual([]);

    // Neither with nor without a code: the old "skip verification when no
    // provider" branch is gone.
    const withoutCode = await authedPost(
      env,
      "/api/auth/2fa/email-otp/enable",
      token,
      {},
    );
    expect(withoutCode.status).toBe(503);
    expect(withoutCode.body.code).toBe("EMAIL_NOT_CONFIGURED");

    const withCode = await authedPost(
      env,
      "/api/auth/2fa/email-otp/enable",
      token,
      { code: "123456" },
    );
    expect(withCode.status).toBe(503);
    expect(withCode.body.code).toBe("EMAIL_NOT_CONFIGURED");

    expect(emailOtpEnabled(db, "u-settings")).toBe(0);
  });

  it("always allows disabling, even when email is not configured", async () => {
    const db = makeDb(EMAIL_UNCONFIGURED);
    await seedUser(db, {
      id: "u-settings",
      email: "settings@example.com",
      emailOtp: true,
    });
    const env = makeBackupEnv(db);
    const token = await authedToken(env, "u-settings");
    expect(emailOtpEnabled(db, "u-settings")).toBe(1);

    const res = await authedPost(
      env,
      "/api/auth/2fa/email-otp/disable",
      token,
      { password: PASSWORD },
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(emailOtpEnabled(db, "u-settings")).toBe(0);
  });

  it("still enables with a valid code when email is configured", async () => {
    stubOutboundEmail();
    const db = makeDb(EMAIL_CONFIGURED);
    await seedUser(db, { id: "u-settings", email: "settings@example.com" });
    const env = makeBackupEnv(db);
    const token = await authedToken(env, "u-settings");

    const send = await authedPost(
      env,
      "/api/auth/2fa/email-otp/send-verify",
      token,
      {},
    );
    expect(send.status).toBe(200);

    const code = kvOf(env).store.get("otp:u-settings:email_otp_setup");
    const enable = await authedPost(
      env,
      "/api/auth/2fa/email-otp/enable",
      token,
      { code },
    );

    expect(enable.status).toBe(200);
    expect(emailOtpEnabled(db, "u-settings")).toBe(1);
  });
});

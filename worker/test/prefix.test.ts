import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_PREFIX, getTablePrefix } from "../src/types";
import type { Env } from "../src/types";
import { detectTablePrefixes, runSetup } from "../src/lib/setup";
import {
  MockD1,
  cookieHeader,
  makeApp,
  makeEnv,
  makeToken,
  request,
  seedSession,
  TEST_SETUP_SECRET,
} from "./helpers";

function secretHeader(): Record<string, string> {
  return { "X-Setup-Secret": TEST_SETUP_SECRET };
}

function envWith(overrides: Record<string, unknown>): Env {
  return makeEnv(overrides) as unknown as Env;
}

describe("getTablePrefix three-state resolution", () => {
  it("unset (undefined) resolves to the default prefix with a trailing underscore", () => {
    expect(getTablePrefix(envWith({ TABLE_PREFIX: undefined }))).toBe(
      "enotify_",
    );
  });

  it("unset (null) resolves to the default prefix with a trailing underscore", () => {
    expect(getTablePrefix(envWith({ TABLE_PREFIX: null }))).toBe("enotify_");
  });

  it("a custom value gets a trailing underscore appended", () => {
    expect(getTablePrefix(envWith({ TABLE_PREFIX: "eNotify" }))).toBe(
      "eNotify_",
    );
  });

  it("a custom value already ending with an underscore is kept as is", () => {
    expect(getTablePrefix(envWith({ TABLE_PREFIX: "eNotify_" }))).toBe(
      "eNotify_",
    );
  });

  it("an explicit empty string resolves to no prefix", () => {
    expect(getTablePrefix(envWith({ TABLE_PREFIX: "" }))).toBe("");
  });

  it("the default prefix constant is the bare project default", () => {
    expect(DEFAULT_TABLE_PREFIX).toBe("enotify");
    expect(`${DEFAULT_TABLE_PREFIX}_`).toBe("enotify_");
  });
});

describe("detectTablePrefixes", () => {
  it("detects an initialized schema and keeps the trailing underscore", () => {
    expect(
      detectTablePrefixes([
        "eNotify_users",
        "eNotify_user_2fa",
        "eNotify_items",
        "eNotify_payment_history",
        "eNotify_notification_configs",
        "eNotify_system_settings",
        "eNotify_notification_history",
      ]),
    ).toEqual(new Set(["eNotify_"]));
  });

  it("detects a legacy no-prefix schema", () => {
    expect(
      detectTablePrefixes(["users", "user_2fa", "items", "payment_history"]),
    ).toEqual(new Set([""]));
  });

  it("requires at least 4 core tables before a prefix counts as initialized", () => {
    expect(detectTablePrefixes(["users", "user_2fa", "items"])).toEqual(
      new Set(),
    );
  });

  it("requires a users table before a prefix counts as initialized", () => {
    expect(
      detectTablePrefixes([
        "a_user_2fa",
        "a_items",
        "a_payment_history",
        "a_notification_configs",
      ]),
    ).toEqual(new Set());
  });

  it("ignores unrelated tables from other apps sharing the database", () => {
    expect(
      detectTablePrefixes(["zeta_users", "shortlink_links", "sqlite_sequence"]),
    ).toEqual(new Set());
  });

  it("is case sensitive", () => {
    expect(
      detectTablePrefixes([
        "enotify_users",
        "enotify_items",
        "enotify_payment_history",
        "enotify_notification_configs",
      ]),
    ).toEqual(new Set(["enotify_"]));
    expect(detectTablePrefixes(["USERS", "ITEMS", "USERS_2FA"])).toEqual(
      new Set(),
    );
  });
});

// A database initialized under the "old_" prefix (all 7 core tables).
const OLD_PREFIX_TABLES: Record<string, string[]> = {
  old_users: ["id", "email"],
  old_user_2fa: ["user_id"],
  old_items: ["id"],
  old_payment_history: ["id"],
  old_notification_configs: ["user_id"],
  old_system_settings: ["key"],
  old_notification_history: ["id"],
};

// A legacy database initialized without any prefix (all 7 core tables).
const LEGACY_NO_PREFIX_TABLES: Record<string, string[]> = {
  users: ["id", "email"],
  user_2fa: ["user_id"],
  items: ["id"],
  payment_history: ["id"],
  notification_configs: ["user_id"],
  system_settings: ["key"],
  notification_history: ["id"],
};

describe("runSetup anti-silent-switch guard", () => {
  it("aborts with 409 PREFIX_CONFLICT when the DB is initialized under another prefix and TABLE_PREFIX is unset", async () => {
    const env = envWith({
      TABLE_PREFIX: undefined,
      DB: new MockD1({ tables: OLD_PREFIX_TABLES }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("PREFIX_CONFLICT");
    expect(res.body.resolvedPrefix).toBe("enotify_");
    expect(res.body.detectedPrefixes).toEqual(["old_"]);
    expect(res.body.error).toContain("TABLE_PREFIX");
    expect(res.body.message).toBe(res.body.error);

    // No fresh tables were silently created under the default prefix.
    const db = env.DB as MockD1;
    expect(db.tables.has("enotify_users")).toBe(false);
  });

  it("aborts with the legacy-schema guidance when a no-prefix schema exists and TABLE_PREFIX is unset", async () => {
    const env = envWith({
      TABLE_PREFIX: undefined,
      DB: new MockD1({ tables: LEGACY_NO_PREFIX_TABLES }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PREFIX_CONFLICT");
    expect(res.body.resolvedPrefix).toBe("enotify_");
    expect(res.body.detectedPrefixes).toEqual([""]);
    expect(res.body.error).toContain("legacy schema without table prefix");
    expect(res.body.error).toContain("TABLE_PREFIX=none");

    const db = env.DB as MockD1;
    expect(db.tables.has("enotify_users")).toBe(false);
  });

  it("aborts with the generic mismatch message when an explicit empty prefix meets an old_ schema", async () => {
    const env = envWith({
      TABLE_PREFIX: "",
      DB: new MockD1({ tables: OLD_PREFIX_TABLES }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PREFIX_CONFLICT");
    expect(res.body.resolvedPrefix).toBe("");
    expect(res.body.error).toContain("TABLE_PREFIX mismatch");
    expect(res.body.error).toContain("old_");

    const db = env.DB as MockD1;
    expect(db.tables.has("users")).toBe(false);
  });

  it("succeeds with alreadyInitialized when the configured prefix matches the existing schema", async () => {
    const env = envWith({
      TABLE_PREFIX: "old",
      DB: new MockD1({ tables: OLD_PREFIX_TABLES }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "old_",
      migrations: [{ name: "schema_v1", status: "stamped" }],
    });
  });

  it("initializes a fresh empty DB under the default prefix when TABLE_PREFIX is unset", async () => {
    const env = envWith({ TABLE_PREFIX: undefined });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      effectivePrefix: "enotify_",
      migrations: [{ name: "schema_v1", status: "applied" }],
    });

    const db = env.DB as MockD1;
    expect(db.tables.has("enotify_users")).toBe(true);
  });

  it("does not treat unrelated tables from other apps as a conflict", async () => {
    const env = envWith({
      TABLE_PREFIX: undefined,
      DB: new MockD1({
        tables: { zeta_users: ["id"], shortlink_links: ["id"] },
      }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      effectivePrefix: "enotify_",
      migrations: [{ name: "schema_v1", status: "applied" }],
    });

    const db = env.DB as MockD1;
    expect(db.tables.has("enotify_users")).toBe(true);
    expect(db.tables.has("zeta_users")).toBe(true);
  });
});

describe("admin setup route surfaces prefix conflicts", () => {
  async function adminSetup(env: Env): Promise<{ status: number; body: any }> {
    const app = makeApp();
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "sess-admin",
    });
    await seedSession(env as Record<string, unknown>, "admin-1", "sess-admin");
    return request(app, env, "/api/admin/setup", {
      method: "POST",
      headers: cookieHeader(token),
    });
  }

  it("returns 409 with the conflict body instead of 200", async () => {
    const env = envWith({
      TABLE_PREFIX: undefined,
      DB: new MockD1({ tables: OLD_PREFIX_TABLES }),
    });

    const res = await adminSetup(env);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PREFIX_CONFLICT");
    expect(res.body.error).toBeTypeOf("string");
    expect((env.DB as MockD1).tables.has("enotify_users")).toBe(false);
  });

  it("reports the effective prefix on success", async () => {
    const env = envWith({ TABLE_PREFIX: "eNotify" });

    const res = await adminSetup(env);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      effectivePrefix: "eNotify_",
      migrations: [{ name: "schema_v1", status: "applied" }],
    });
  });
});

describe("runSetup conflict result shape (direct call)", () => {
  it("returns the full conflict payload without touching the database", async () => {
    const env = envWith({
      TABLE_PREFIX: undefined,
      DB: new MockD1({ tables: OLD_PREFIX_TABLES }),
    });

    const result = await runSetup(env);
    expect(result).toEqual({
      success: false,
      code: "PREFIX_CONFLICT",
      error: result.error,
      message: result.error,
      resolvedPrefix: "enotify_",
      detectedPrefixes: ["old_"],
    });
    expect(result.error).toContain('e.g. "old_"');
    expect((env.DB as MockD1).tables.has("enotify_users")).toBe(false);
  });
});

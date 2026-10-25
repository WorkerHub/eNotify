import { describe, expect, it, vi } from "vitest";
import {
  ADMIN,
  BOB,
  SqliteD1,
  callWorker,
  jsonPost,
  makeBackupEnv,
  seedInstance,
} from "./support/backup";
import { cookieHeader, makeToken, seedSession } from "./helpers";

async function userCookie(env: any, userId = BOB.id, sid = "sess-bob") {
  const token = await makeToken("user", { sub: userId, sid });
  await seedSession(env, userId, sid);
  return cookieHeader(token);
}

async function adminCookie(env: any) {
  const token = await makeToken("admin", { sub: ADMIN.id, sid: "sess-admin" });
  await seedSession(env, ADMIN.id, "sess-admin");
  return cookieHeader(token);
}

const EMPTY_DATA_KEYS = [
  "users",
  "user_2fa",
  "items",
  "payment_history",
  "notification_configs",
  "system_settings",
  "notification_history",
];

describe("export file format", () => {
  it("writes the frozen v1 header and all seven data keys", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(env)),
    );

    expect(res.status).toBe(200);
    expect(res.body.format).toBe("enotify-export");
    expect(res.body.format_version).toBe(1);
    expect(typeof res.body.app_version).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.exported_at))).toBe(false);
    expect(res.body.scope).toBe("user");
    expect(Object.keys(res.body.data).sort()).toEqual(
      [...EMPTY_DATA_KEYS].sort(),
    );
  });

  it("sets download headers and forbids caching", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(env)),
    );

    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="enotify-user-.*-plain\.json"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps scope=user to the exporting user's own rows", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(env)),
    );
    const data = res.body.data;

    expect(data.users).toHaveLength(1);
    expect(data.users[0].email).toBe(BOB.email);
    expect(data.user_2fa.map((r: any) => r.user_id)).toEqual([BOB.id]);
    expect(data.items.map((r: any) => r.id).sort()).toEqual([
      "item-bob-1",
      "item-bob-broken",
    ]);
    expect(data.payment_history.map((r: any) => r.id)).toEqual(["pay-bob-1"]);
    expect(data.notification_configs.map((r: any) => r.user_id)).toEqual([
      BOB.id,
    ]);
    expect(data.system_settings).toEqual([]);
    expect(data.notification_history).toEqual([]);
  });

  it("includes notification_history only when the option is on", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);
    const cookie = await userCookie(env);

    const without = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, cookie),
    );
    expect(without.body.data.notification_history).toEqual([]);

    const withHistory = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false, include_history: true }, cookie),
    );
    expect(withHistory.body.data.notification_history).toHaveLength(1);
    expect(withHistory.body.data.notification_history[0].id).toBe("hist-1");
  });

  it("exports JSON columns as parsed values and keeps scalars as-is", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(env)),
    );
    const item = res.body.data.items.find((r: any) => r.id === "item-bob-1");
    const config = res.body.data.notification_configs[0];
    const twofa = res.body.data.user_2fa[0];

    expect(item.channels).toEqual(["telegram", "email"]);
    expect(item.notification_hours).toEqual([9, 21]);
    expect(item.amount).toBe(12.5);
    expect(item.calendar_mode).toBe("lunar");
    expect(item.lunar_expiry_date).toBe("2026-09-15");
    expect(item._raw).toBeUndefined();

    expect(config.enabled_channels).toEqual(["telegram", "email"]);
    expect(config.telegram_config).toEqual({
      bot_token: "123:abc",
      chat_id: "-100",
    });
    expect(config.notification_hours).toEqual([8, 20]);
    // default_channel is a plain string column, not JSON.
    expect(config.default_channel).toBe("telegram");

    expect(twofa.passkey_credentials).toEqual([
      {
        id: "cred-1",
        publicKey: "pk-base64",
        counter: 3,
        transports: ["internal"],
      },
    ]);
    // TOTP secret is exported verbatim (no transformation).
    expect(twofa.totp_secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("flags unparsable JSON columns with _raw and keeps the original string", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(env)),
    );
    const broken = res.body.data.items.find(
      (r: any) => r.id === "item-bob-broken",
    );

    expect(broken.channels).toBe('{"broken": ');
    expect(broken._raw).toEqual(["channels"]);
  });

  it("records an audit line for a personal export without leaking the passphrase", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const res = await callWorker(
        env,
        "/api/me/export",
        jsonPost(
          { encrypted: true, passphrase: "correct horse battery staple" },
          await userCookie(env),
        ),
      );
      expect(res.status).toBe(200);

      const auditLines = spy.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.startsWith("[audit] backup "));
      expect(auditLines).toHaveLength(1);

      const event = JSON.parse(auditLines[0].replace("[audit] backup ", ""));
      expect(event.action).toBe("export");
      expect(event.scope).toBe("user");
      expect(event.operator).toBe(BOB.id);
      expect(event.encrypted).toBe(true);
      expect(event.rows.items).toBe(2);
      expect(event.rows.users).toBe(1);
      expect(auditLines[0]).not.toContain("correct horse battery staple");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("export → import round trip", () => {
  it("restores an instance file with no loss (JSON columns, _raw, 2FA, lunar, default_channel)", async () => {
    const source = new SqliteD1();
    seedInstance(source);
    const sourceEnv = makeBackupEnv(source);

    const exported = await callWorker(
      sourceEnv,
      "/api/admin/export",
      jsonPost(
        { encrypted: false, include_history: true },
        await adminCookie(sourceEnv),
      ),
    );
    expect(exported.status).toBe(200);
    expect(exported.body.scope).toBe("instance");
    expect(exported.body.data.users).toHaveLength(3);

    const target = new SqliteD1();
    const targetEnv = makeBackupEnv(target);
    const imported = await callWorker(
      targetEnv,
      "/api/admin/import",
      jsonPost(
        { mode: "restore", file: exported.body },
        await adminCookie(targetEnv),
      ),
    );
    expect(imported.status).toBe(200);
    expect(imported.body.written).toEqual({
      users: 3,
      user_2fa: 1,
      items: 3,
      payment_history: 2,
      notification_configs: 2,
      system_settings: 2,
      notification_history: 1,
    });

    const reExported = await callWorker(
      targetEnv,
      "/api/admin/export",
      jsonPost(
        { encrypted: false, include_history: true },
        await adminCookie(targetEnv),
      ),
    );

    // Whole-file equality: every ID, timestamp, amount, JSON column and the
    // _raw fallback row survive the trip unchanged.
    expect(reExported.body.data).toEqual(exported.body.data);

    const broken = target.select<any>(
      "SELECT channels FROM items WHERE id = ?",
      "item-bob-broken",
    );
    expect(broken[0].channels).toBe('{"broken": ');
  });

  it("round-trips through the encrypted envelope", async () => {
    const source = new SqliteD1();
    seedInstance(source);
    const sourceEnv = makeBackupEnv(source);

    const exported = await callWorker(
      sourceEnv,
      "/api/me/export",
      jsonPost(
        { passphrase: "s3cret-passphrase", include_history: true },
        await userCookie(sourceEnv),
      ),
    );
    expect(exported.body.format).toBe("enotify-export-encrypted");

    // A different instance holding an account with the same email: merge
    // targets the signed-in account, not the file's (already gone) id.
    const target = new SqliteD1();
    target.insert("users", {
      id: "u-bob-2",
      email: BOB.email,
      password_hash: "hash",
      role: "user",
      created_at: "2026-10-25T10:00:00.000Z",
      updated_at: "2026-10-25T10:00:00.000Z",
    });
    const targetEnv = makeBackupEnv(target);
    const token = await makeToken("user", { sub: "u-bob-2", sid: "sess-bob2" });
    await seedSession(targetEnv, "u-bob-2", "sess-bob2");

    const imported = await callWorker(
      targetEnv,
      "/api/me/import",
      jsonPost(
        { file: exported.body, passphrase: "s3cret-passphrase" },
        cookieHeader(token),
      ),
    );
    expect(imported.status).toBe(200);
    expect(imported.body.written.items).toBe(2);
    expect(imported.body.written.payment_history).toBe(1);
  });
});

describe("schema-evolution tolerance", () => {
  it("ignores unknown fields and applies current column defaults for missing ones", async () => {
    const source = new SqliteD1();
    seedInstance(source);
    const sourceEnv = makeBackupEnv(source);

    const exported = await callWorker(
      sourceEnv,
      "/api/admin/export",
      jsonPost({ encrypted: false }, await adminCookie(sourceEnv)),
    );

    const item = exported.body.data.items.find(
      (r: any) => r.id === "item-bob-1",
    );
    item.unknown_future_column = "ignored";
    delete item.currency;
    delete item.auto_renew;
    delete item.reminder_value;

    const target = new SqliteD1();
    const targetEnv = makeBackupEnv(target);
    const imported = await callWorker(
      targetEnv,
      "/api/admin/import",
      jsonPost(
        { mode: "restore", file: exported.body },
        await adminCookie(targetEnv),
      ),
    );
    expect(imported.status).toBe(200);

    const row = target.select<any>(
      "SELECT * FROM items WHERE id = ?",
      "item-bob-1",
    )[0];
    expect(row.currency).toBe("CNY"); // schema default
    expect(row.auto_renew).toBe(1); // schema default
    expect(row.reminder_value).toBe(7); // schema default
    expect("unknown_future_column" in row).toBe(false);
  });

  it("rejects files whose format_version is newer than supported", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost(
        {
          mode: "restore",
          file: {
            format: "enotify-export",
            format_version: 2,
            app_version: "9.9.9",
            exported_at: new Date().toISOString(),
            scope: "instance",
            data: {},
          },
        },
        await adminCookie(env),
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_FORMAT_VERSION");
    expect(res.body.error).toContain("format_version");
  });

  it("rejects a file that is neither a plain nor an encrypted enotify export", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);

    const res = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ file: { hello: "world" } }, await adminCookie(env)),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_FORMAT");
  });
});

import { describe, expect, it } from "vitest";
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
import { assertCountsUnchanged } from "../src/lib/backup/import";
import { emptyData } from "../src/lib/backup/format";

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

/** Exports the seeded source instance as a plain, history-included file. */
async function exportInstanceFile() {
  const source = new SqliteD1();
  seedInstance(source);
  const env = makeBackupEnv(source);
  const res = await callWorker(
    env,
    "/api/admin/export",
    jsonPost(
      { encrypted: false, include_history: true },
      await adminCookie(env),
    ),
  );
  expect(res.status).toBe(200);
  return { file: res.body, source };
}

const EMPTY_COUNTS = {
  users: 0,
  user_2fa: 0,
  items: 0,
  payment_history: 0,
  notification_configs: 0,
  system_settings: 0,
  notification_history: 0,
};

describe("restore mode preconditions", () => {
  it("refuses a non-empty target instance (preview blocks, import 409)", async () => {
    const { file } = await exportInstanceFile();

    const target = new SqliteD1();
    seedInstance(target);
    const env = makeBackupEnv(target);
    const cookie = await adminCookie(env);

    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.can_execute).toBe(false);
    expect(preview.body.conflicts.target_users).toBe(3);
    expect(preview.body.blockers[0].code).toBe("RESTORE_TARGET_NOT_EMPTY");

    const imported = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(imported.status).toBe(409);
    expect(imported.body.code).toBe("RESTORE_TARGET_NOT_EMPTY");
    expect(target.count("users")).toBe(3);
    expect(target.count("items")).toBe(3);
  });

  it("refuses a user-scope file in restore mode", async () => {
    const source = new SqliteD1();
    seedInstance(source);
    const sourceEnv = makeBackupEnv(source);
    const userFile = await callWorker(
      sourceEnv,
      "/api/me/export",
      jsonPost({ encrypted: false }, await userCookie(sourceEnv)),
    );

    const target = new SqliteD1();
    const env = makeBackupEnv(target);
    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost(
        { mode: "restore", file: userFile.body },
        await adminCookie(env),
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MODE_NOT_ALLOWED");
    expect(target.count("users")).toBe(0);
  });

  it("blocks a file with a dangling reference or a duplicated primary key", async () => {
    const { file } = await exportInstanceFile();

    const dangling = structuredClone(file);
    dangling.data.payment_history[0].item_id = "item-does-not-exist";
    const target = new SqliteD1();
    const env = makeBackupEnv(target);
    const cookie = await adminCookie(env);

    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "restore", file: dangling }, cookie),
    );
    expect(preview.body.can_execute).toBe(false);
    expect(
      preview.body.blockers.some((b: any) => b.code === "REFERENCE_MISSING"),
    ).toBe(true);

    const imported = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file: dangling }, cookie),
    );
    expect(imported.status).toBe(409);
    expect(imported.body.code).toBe("REFERENCE_MISSING");
    expect(target.count("payment_history")).toBe(0);
  });

  it("blocks a row that misses a required column", async () => {
    const { file } = await exportInstanceFile();
    const broken = structuredClone(file);
    delete broken.data.items[0].name;

    const env = makeBackupEnv(new SqliteD1());
    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "restore", file: broken }, await adminCookie(env)),
    );

    expect(preview.body.can_execute).toBe(false);
    expect(
      preview.body.blockers.some((b: any) => b.code === "MISSING_COLUMN"),
    ).toBe(true);
  });

  it("flags a newer format_version before touching the database", async () => {
    const { file } = await exportInstanceFile();
    const newer = { ...file, format_version: 2 };

    const env = makeBackupEnv(new SqliteD1());
    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file: newer }, await adminCookie(env)),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_FORMAT_VERSION");
  });
});

describe("restore mode execution", () => {
  it("restores every table into an empty instance with matching rows", async () => {
    const { file, source } = await exportInstanceFile();
    const target = new SqliteD1();
    const env = makeBackupEnv(target);

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, await adminCookie(env)),
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe("restore");

    // Row counts per table match the source instance exactly.
    for (const table of Object.keys(EMPTY_COUNTS)) {
      expect(target.count(table)).toBe(source.count(table));
    }

    // Spot checks: a channel config and one item are byte-identical.
    const sourceConfig = source.select(
      "SELECT * FROM notification_configs WHERE user_id = ?",
      BOB.id,
    );
    const targetConfig = target.select(
      "SELECT * FROM notification_configs WHERE user_id = ?",
      BOB.id,
    );
    expect(targetConfig).toEqual(sourceConfig);
    expect(
      JSON.parse(String((targetConfig[0] as any).telegram_config)),
    ).toEqual({
      bot_token: "123:abc",
      chat_id: "-100",
    });

    const sourceItem = source.select(
      "SELECT * FROM items WHERE id = ?",
      "item-bob-1",
    );
    const targetItem = target.select(
      "SELECT * FROM items WHERE id = ?",
      "item-bob-1",
    );
    expect(targetItem).toEqual(sourceItem);

    // Restore-specific guidance is surfaced to the operator.
    expect(res.body.notices.join(" ")).toContain("API Key");
    expect(res.body.notices.join(" ")).toContain("重新登录");
  });

  it("reports the planned rows in preview and the actual rows after import", async () => {
    const { file } = await exportInstanceFile();
    const target = new SqliteD1();
    const env = makeBackupEnv(target);
    const cookie = await adminCookie(env);

    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(preview.status).toBe(200);
    expect(preview.body.can_execute).toBe(true);
    expect(preview.body.counts).toEqual({
      users: 3,
      user_2fa: 1,
      items: 3,
      payment_history: 2,
      notification_configs: 2,
      system_settings: 2,
      notification_history: 1,
    });
    expect(preview.body.users.map((u: any) => u.email).sort()).toEqual([
      "admin@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
    // A preview must not write anything.
    expect(target.count("users")).toBe(0);

    const imported = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(imported.body.written).toEqual(preview.body.will_write);
  });

  it("overwrites installed system settings defaults instead of aborting", async () => {
    const { file } = await exportInstanceFile();
    const target = new SqliteD1();
    // A freshly initialized instance already holds default settings keys.
    target.insert("system_settings", {
      key: "app_name",
      value: "default app",
      updated_at: "2026-10-25T09:00:00.000Z",
    });
    const env = makeBackupEnv(target);
    const cookie = await adminCookie(env);

    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(preview.body.can_execute).toBe(true);
    expect(preview.body.conflicts.settings_overwritten).toEqual(["app_name"]);

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, cookie),
    );
    expect(res.status).toBe(200);
    expect(
      target.select<any>(
        "SELECT value FROM system_settings WHERE key = ?",
        "app_name",
      )[0].value,
    ).toBe("eNotify");
  });

  it("leaves no partial data when a write fails mid-batch", async () => {
    const { file } = await exportInstanceFile();
    const target = new SqliteD1();
    // Fail only the payment_history INSERT so the batch aborts after users,
    // user_2fa, items and configs were already written inside the transaction.
    target.failWhen = (sql) =>
      /^\s*INSERT/i.test(sql) && sql.includes("payment_history");
    const env = makeBackupEnv(target);

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, await adminCookie(env)),
    );

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("WRITE_FAILED");
    // Exactly one batch was attempted, and the transaction rolled back: users,
    // items and configs that were written earlier in the batch are gone too.
    expect(target.batchCalls).toBe(1);
    for (const table of Object.keys(EMPTY_COUNTS)) {
      expect(target.count(table)).toBe(0);
    }
  });

  it("restores into a prefixed schema ({prefix} resolution)", async () => {
    const { file } = await exportInstanceFile();
    const target = new SqliteD1({ prefix: "eNotify_" });
    const env = makeBackupEnv(target, { TABLE_PREFIX: "eNotify" });

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "restore", file }, await adminCookie(env)),
    );

    expect(res.status).toBe(200);
    expect(
      target.select<{ n: number }>("SELECT COUNT(*) AS n FROM eNotify_items")[0]
        .n,
    ).toBe(3);
    // The unprefixed table names must not exist in this database.
    const unprefixed = target.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
    );
    expect(unprefixed).toEqual([]);
  });
});

describe("staleness guard", () => {
  it("rejects a write when a table changed since planning", () => {
    const before = { ...EMPTY_COUNTS };
    const current = { ...EMPTY_COUNTS, users: 1 };
    expect(() => assertCountsUnchanged(before, current)).toThrowError(
      /发生变化/,
    );
    try {
      assertCountsUnchanged(before, current);
    } catch (err: any) {
      expect(err.code).toBe("STALE_PREVIEW");
      expect(err.status).toBe(409);
      expect(err.details).toEqual({ table: "users", expected: 0, actual: 1 });
    }
    expect(() =>
      assertCountsUnchanged(before, { ...EMPTY_COUNTS }),
    ).not.toThrow();
  });
});

describe("file shape tolerance", () => {
  it("accepts a file whose notification_history key is missing", async () => {
    const db = new SqliteD1();
    seedInstance(db);
    const env = makeBackupEnv(db);
    const data = emptyData();
    const file = {
      format: "enotify-export",
      format_version: 1,
      app_version: "test",
      exported_at: new Date().toISOString(),
      scope: "user",
      data: { ...data, users: [] },
    };
    delete (file.data as any).notification_history;

    const res = await callWorker(
      env,
      "/api/me/import/preview",
      jsonPost({ file }, await userCookie(env)),
    );
    // Structurally valid: it fails later on missing merge source, not on shape.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MERGE_SOURCE_NOT_FOUND");
  });
});

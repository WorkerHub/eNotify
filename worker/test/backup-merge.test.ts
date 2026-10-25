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

const NEW_USER_ID = "u-bob-new";
const OTHER_USER_ID = "u-other";

function insertUser(
  db: SqliteD1,
  id: string,
  email: string,
  role = "user",
): void {
  db.insert("users", {
    id,
    email,
    password_hash: "$argon2id$hash",
    role,
    is_active: 1,
    email_verified: 1,
    base_currency: "CNY",
    timezone: "UTC",
    language: "zh",
    theme: "system",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
  });
}

/** Target instance: one account with the same email as the file's owner. */
function makeTarget(): SqliteD1 {
  const db = new SqliteD1();
  insertUser(db, NEW_USER_ID, BOB.email);
  insertUser(db, OTHER_USER_ID, "other@example.com");
  db.insert("items", {
    id: "other-item",
    user_id: OTHER_USER_ID,
    name: "Other user item",
    expiry_date: "2027-01-01",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
  });
  db.insert("notification_configs", {
    user_id: NEW_USER_ID,
    enabled_channels: JSON.stringify(["bark"]),
    default_channel: "bark",
    bark_config: JSON.stringify({ device_key: "old" }),
    updated_at: "2026-10-20T00:00:00.000Z",
  });
  return db;
}

async function sessionFor(env: any, sub: string, sid: string, role = "user") {
  const token = await makeToken(role as "user" | "admin", { sub, sid });
  await seedSession(env, sub, sid);
  return cookieHeader(token);
}

async function exportInstanceFile(options: { includeHistory?: boolean } = {}) {
  const source = new SqliteD1();
  seedInstance(source);
  const env = makeBackupEnv(source);
  const res = await callWorker(
    env,
    "/api/admin/export",
    jsonPost(
      { encrypted: false, include_history: options.includeHistory ?? false },
      await sessionFor(env, ADMIN.id, "sess-admin", "admin"),
    ),
  );
  expect(res.status).toBe(200);
  return res.body;
}

describe("merge mode preview", () => {
  it("reports what will be written, what is ignored and that config is replaced", async () => {
    const file = await exportInstanceFile();
    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    const preview = await callWorker(
      env,
      "/api/me/import/preview",
      jsonPost({ file }, cookie),
    );

    expect(preview.status).toBe(200);
    expect(preview.body.mode).toBe("merge");
    expect(preview.body.counts.items).toBe(3);
    expect(preview.body.will_write).toEqual({
      users: 0,
      user_2fa: 0,
      items: 2,
      payment_history: 1,
      notification_configs: 1,
      system_settings: 0,
      notification_history: 0,
    });
    expect(preview.body.ignored_tables).toEqual([
      "users",
      "user_2fa",
      "system_settings",
      "notification_history",
    ]);
    expect(preview.body.conflicts.config_overwritten).toBe(true);
    expect(preview.body.conflicts.skipped_foreign_items).toBe(1);
    expect(preview.body.conflicts.skipped_foreign_payments).toBe(1);
    expect(preview.body.can_execute).toBe(true);

    // A preview never writes.
    expect(target.count("items")).toBe(1);
    expect(target.count("payment_history")).toBe(0);
  });

  it("refuses a file that has no data for the importing account", async () => {
    const file = await exportInstanceFile();
    const target = new SqliteD1();
    insertUser(target, "u-stranger", "stranger@example.com");
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, "u-stranger", "sess-stranger");

    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file }, cookie),
    );

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MERGE_SOURCE_NOT_FOUND");
    expect(res.body.error).toContain("stranger@example.com");
    expect(target.count("items")).toBe(0);
  });
});

describe("merge mode execution", () => {
  it("regenerates every id, rewrites owners and payment references", async () => {
    const file = await exportInstanceFile({ includeHistory: true });
    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file }, cookie),
    );

    expect(res.status).toBe(200);
    expect(res.body.written).toEqual({
      users: 0,
      user_2fa: 0,
      items: 2,
      payment_history: 1,
      notification_configs: 1,
      system_settings: 0,
      notification_history: 0,
    });
    expect(res.body.notices).toEqual([]); // restore-only notices stay out of merge

    const importedItems = target.select<any>(
      "SELECT * FROM items WHERE user_id = ? ORDER BY name",
      NEW_USER_ID,
    );
    expect(importedItems).toHaveLength(2);
    const fileItemIds = file.data.items
      .filter((row: any) => row.user_id === BOB.id)
      .map((row: any) => row.id);
    for (const item of importedItems) {
      expect(fileItemIds).not.toContain(item.id);
      expect(item.user_id).toBe(NEW_USER_ID);
    }

    // Scalar payload survives the copy.
    const vps = importedItems.find((item) => item.name === "VPS");
    expect(vps.amount).toBe(12.5);
    expect(vps.currency).toBe("USD");
    expect(vps.calendar_mode).toBe("lunar");
    expect(vps.lunar_expiry_date).toBe("2026-09-15");
    expect(JSON.parse(vps.channels)).toEqual(["telegram", "email"]);
    expect(JSON.parse(vps.notification_hours)).toEqual([9, 21]);

    // payment_history points at the NEW item id and keeps its own new id.
    const payments = target.select<any>(
      "SELECT * FROM payment_history WHERE user_id = ?",
      NEW_USER_ID,
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].id).not.toBe("pay-bob-1");
    expect(payments[0].item_id).toBe(vps.id);
    expect(payments[0].amount).toBe(12.5);

    // Another account's data is untouched and nothing from other users in the
    // file leaked in.
    expect(target.count("items")).toBe(3);
    const otherItems = target.select<any>(
      "SELECT * FROM items WHERE user_id = ?",
      OTHER_USER_ID,
    );
    expect(otherItems).toHaveLength(1);
    expect(otherItems[0].id).toBe("other-item");
    expect(
      target.select("SELECT * FROM items WHERE user_id = ?", ADMIN.id),
    ).toHaveLength(0);
  });

  it("replaces the whole channel config of the importing account", async () => {
    const file = await exportInstanceFile();
    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    await callWorker(env, "/api/me/import", jsonPost({ file }, cookie));

    const config = target.select<any>(
      "SELECT * FROM notification_configs WHERE user_id = ?",
      NEW_USER_ID,
    );
    expect(config).toHaveLength(1);
    expect(config[0].default_channel).toBe("telegram");
    expect(JSON.parse(config[0].enabled_channels)).toEqual([
      "telegram",
      "email",
    ]);
    expect(JSON.parse(config[0].telegram_config)).toEqual({
      bot_token: "123:abc",
      chat_id: "-100",
    });
    // The old bark config is gone (whole-row replacement), not merged.
    expect(JSON.parse(config[0].bark_config)).toEqual({});
  });

  it("leaves users, 2FA and system settings alone", async () => {
    const file = await exportInstanceFile();
    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    await callWorker(env, "/api/me/import", jsonPost({ file }, cookie));

    expect(target.count("users")).toBe(2);
    expect(target.count("user_2fa")).toBe(0);
    expect(target.count("system_settings")).toBe(0);
    expect(target.count("notification_history")).toBe(0);
    // No stray account was created from the file.
    expect(
      target.select("SELECT * FROM users WHERE email = ?", ADMIN.email),
    ).toHaveLength(0);
  });

  it("skips payment rows whose item is missing from the file", async () => {
    const file = await exportInstanceFile();
    const trimmed = structuredClone(file);
    trimmed.data.items = trimmed.data.items.filter(
      (row: any) => row.id !== "item-bob-1",
    );
    const trimmedVpsGone = trimmed.data.items;
    expect(trimmedVpsGone.some((row: any) => row.id === "item-bob-1")).toBe(
      false,
    );

    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file: trimmed }, cookie),
    );

    expect(res.status).toBe(200);
    expect(res.body.written.items).toBe(1);
    expect(res.body.written.payment_history).toBe(0);
    expect(res.body.warnings.join(" ")).toContain("已跳过");
    expect(target.count("payment_history")).toBe(0);
  });

  it("does not import notification history in merge mode", async () => {
    const file = await exportInstanceFile({ includeHistory: true });
    expect(file.data.notification_history).toHaveLength(1);

    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");
    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file }, cookie),
    );

    expect(res.status).toBe(200);
    expect(res.body.written.notification_history).toBe(0);
    expect(target.count("notification_history")).toBe(0);
    expect(res.body.warnings.join(" ")).toContain("不导入通知历史");
  });

  it("lets an admin merge into their own account through the admin endpoint", async () => {
    const file = await exportInstanceFile();
    const target = new SqliteD1();
    insertUser(target, "u-admin-new", ADMIN.email, "admin");
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(
      env,
      "u-admin-new",
      "sess-admin-new",
      "admin",
    );

    const preview = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ mode: "merge", file }, cookie),
    );
    expect(preview.body.mode).toBe("merge");
    expect(preview.body.will_write.items).toBe(1);

    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ mode: "merge", file }, cookie),
    );
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("merge");
    const items = target.select<any>(
      "SELECT * FROM items WHERE user_id = ?",
      "u-admin-new",
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Domain");
  });

  it("writes nothing when a merge batch fails", async () => {
    const file = await exportInstanceFile();
    const target = makeTarget();
    const before = target.count("items");
    target.failWhen = (sql) =>
      /^\s*INSERT/i.test(sql) && sql.includes("payment_history");
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file }, cookie),
    );

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("WRITE_FAILED");
    expect(target.count("items")).toBe(before);
    expect(target.count("payment_history")).toBe(0);
    const config = target.select<any>(
      "SELECT * FROM notification_configs WHERE user_id = ?",
      NEW_USER_ID,
    );
    expect(config[0].default_channel).toBe("bark");
  });

  it("rejects a mode that the personal endpoint does not support", async () => {
    const file = await exportInstanceFile();
    const target = makeTarget();
    const env = makeBackupEnv(target);
    const cookie = await sessionFor(env, NEW_USER_ID, "sess-new");

    const res = await callWorker(
      env,
      "/api/me/import",
      jsonPost({ file, mode: "restore" }, cookie),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MODE_NOT_ALLOWED");
  });
});

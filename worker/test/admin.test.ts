import { describe, expect, it } from "vitest";
import {
  MockD1,
  cookieHeader,
  makeApp,
  makeEnv,
  makeToken,
  request,
  seedSession,
} from "./helpers";

describe("POST /api/admin/setup", () => {
  it("returns 200 with the expected fields for an admin", async () => {
    const env = makeEnv();
    const app = makeApp();
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "sess-admin",
    });
    await seedSession(env, "admin-1", "sess-admin");

    const res = await request(app, env, "/api/admin/setup", {
      method: "POST",
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, effectivePrefix: "" });

    const db = env.DB as MockD1;
    expect(db.tables.has("users")).toBe(true);
  });

  it("reports alreadyInitialized when the database is already set up", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: {
          users: ["id", "email"],
          notification_history: ["id", "body"],
          items: ["id", "calendar_mode", "lunar_expiry_date"],
        },
      }),
    });
    const app = makeApp();
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "sess-admin",
    });
    await seedSession(env, "admin-1", "sess-admin");

    const res = await request(app, env, "/api/admin/setup", {
      method: "POST",
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
    });
  });

  it("returns 403 for a non-admin user", async () => {
    const env = makeEnv();
    const app = makeApp();
    const token = await makeToken("user", { sub: "user-1", sid: "sess-user" });
    await seedSession(env, "user-1", "sess-user");

    const res = await request(app, env, "/api/admin/setup", {
      method: "POST",
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when not logged in", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await request(app, env, "/api/admin/setup", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("succeeds even when SETUP_SECRET is not configured", async () => {
    const env = makeEnv({ SETUP_SECRET: undefined });
    const app = makeApp();
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "sess-admin",
    });
    await seedSession(env, "admin-1", "sess-admin");

    const res = await request(app, env, "/api/admin/setup", {
      method: "POST",
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, effectivePrefix: "" });
  });
});

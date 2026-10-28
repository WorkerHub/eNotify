import { describe, expect, it } from "vitest";
import {
  MockD1,
  cookieHeader,
  ipHeader,
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

describe("POST /api/setup rate limiting", () => {
  it("returns 429 on the 4th attempt from the same IP", async () => {
    const env = makeEnv();
    const app = makeApp();
    const headers = { ...secretHeader(), ...ipHeader("1.1.1.1") };

    for (let i = 0; i < 3; i++) {
      const res = await request(app, env, "/api/setup", {
        method: "POST",
        headers,
      });
      expect(res.status).toBe(200);
    }

    const fourth = await request(app, env, "/api/setup", {
      method: "POST",
      headers,
    });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual({ error: "Too many requests" });
  });

  it("counts failed attempts (invalid secret) before the secret check", async () => {
    const env = makeEnv();
    const app = makeApp();
    const headers = {
      "X-Setup-Secret": "wrong-secret",
      ...ipHeader("2.2.2.2"),
    };

    for (let i = 0; i < 3; i++) {
      const res = await request(app, env, "/api/setup", {
        method: "POST",
        headers,
      });
      expect(res.status).toBe(403);
    }

    const fourth = await request(app, env, "/api/setup", {
      method: "POST",
      headers,
    });
    expect(fourth.status).toBe(429);
  });

  it("does not affect other IPs", async () => {
    const env = makeEnv();
    const app = makeApp();

    const ipA = { ...secretHeader(), ...ipHeader("3.3.3.3") };
    for (let i = 0; i < 3; i++) {
      const res = await request(app, env, "/api/setup", {
        method: "POST",
        headers: ipA,
      });
      expect(res.status).toBe(200);
    }

    // A different IP still has its full quota.
    const ipB = { ...secretHeader(), ...ipHeader("4.4.4.4") };
    const resB = await request(app, env, "/api/setup", {
      method: "POST",
      headers: ipB,
    });
    expect(resB.status).toBe(200);

    // IP A is now exhausted.
    const fourth = await request(app, env, "/api/setup", {
      method: "POST",
      headers: ipA,
    });
    expect(fourth.status).toBe(429);
  });
});

describe("GET /api/setup/state", () => {
  it("returns enabled=true when the system_settings table does not exist", async () => {
    const env = makeEnv({ DB: new MockD1() });
    const app = makeApp();

    const res = await request(app, env, "/api/setup/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it("returns enabled=false when setup_page_enabled is '0'", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: { system_settings: ["key", "value", "updated_at"] },
        settings: { setup_page_enabled: "0" },
      }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  it("returns enabled=true when setup_page_enabled is '1'", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: { system_settings: ["key", "value", "updated_at"] },
        settings: { setup_page_enabled: "1" },
      }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it("returns enabled=true when the setting row is missing (default)", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: { system_settings: ["key", "value", "updated_at"] },
      }),
    });
    const app = makeApp();

    const res = await request(app, env, "/api/setup/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it("is not swallowed by the GET 405 catch-all", async () => {
    const env = makeEnv({ DB: new MockD1() });
    const app = makeApp();

    const res = await request(app, env, "/api/setup/state");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/setup (regression)", () => {
  it("succeeds with the correct secret and initializes the database", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "applied" },
        { name: "schema_v2", status: "applied" },
      ],
    });

    const db = env.DB as MockD1;
    expect(db.tables.has("users")).toBe(true);
    expect(db.ledger.get("_schema_migrations")).toEqual([
      "schema_v1",
      "schema_v2",
    ]);
  });

  it("reports alreadyInitialized on a second call", async () => {
    const env = makeEnv();
    const app = makeApp();

    await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: secretHeader(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyInitialized: true,
      effectivePrefix: "",
      migrations: [
        { name: "schema_v1", status: "skipped" },
        { name: "schema_v2", status: "skipped" },
      ],
    });
  });

  it("rejects a wrong secret with 403", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: { "X-Setup-Secret": "nope" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a missing secret with 403", async () => {
    const env = makeEnv();
    const app = makeApp();

    const res = await request(app, env, "/api/setup", { method: "POST" });
    expect(res.status).toBe(403);
  });

  it("rejects when SETUP_SECRET is not configured", async () => {
    const env = makeEnv({ SETUP_SECRET: undefined });
    const app = makeApp();

    const res = await request(app, env, "/api/setup", {
      method: "POST",
      headers: { "X-Setup-Secret": "anything" },
    });
    expect(res.status).toBe(403);
  });
});

describe("admin system settings: setup_page_enabled", () => {
  async function adminRequest(
    env: ReturnType<typeof makeEnv>,
    path: string,
    init: RequestInit,
  ) {
    const app = makeApp();
    const token = await makeToken("admin", {
      sub: "admin-1",
      sid: "sess-admin",
    });
    await seedSession(env, "admin-1", "sess-admin");
    return request(app, env, path, {
      ...init,
      headers: { ...cookieHeader(token), ...(init.headers ?? {}) },
    });
  }

  it("accepts '0' and '1', rejects other values", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: { system_settings: ["key", "value", "updated_at"] },
      }),
    });

    const ok0 = await adminRequest(env, "/api/admin/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_page_enabled: "0" }),
    });
    expect(ok0.status).toBe(200);

    const ok1 = await adminRequest(env, "/api/admin/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_page_enabled: "1" }),
    });
    expect(ok1.status).toBe(200);

    const bad2 = await adminRequest(env, "/api/admin/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_page_enabled: "2" }),
    });
    expect(bad2.status).toBe(400);

    const badBool = await adminRequest(env, "/api/admin/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_page_enabled: "true" }),
    });
    expect(badBool.status).toBe(400);
  });

  it("reads the value back via GET", async () => {
    const env = makeEnv({
      DB: new MockD1({
        tables: { system_settings: ["key", "value", "updated_at"] },
      }),
    });

    await adminRequest(env, "/api/admin/system/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setup_page_enabled: "0" }),
    });

    const res = await adminRequest(env, "/api/admin/system/settings", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    expect(res.body.setup_page_enabled).toBe("0");
  });
});

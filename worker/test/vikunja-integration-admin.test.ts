import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationRoutes } from "../src/routes/integrations";
import { meRoutes } from "../src/routes/me";
import type { Env } from "../src/types";
import { cookieHeader, makeToken, request, seedSession } from "./helpers";
import type { SqliteD1 } from "./support/sqlite-d1";
import {
  VIKUNJA_PREFIX,
  VIKUNJA_USER_ID,
  seedVikunjaConfig,
  seedVikunjaUser,
  setupVikunjaDb,
  signVikunjaBody,
} from "./support/vikunja";

const app = new Hono();
app.route("/api/me", meRoutes);
app.route("/api/integrations", integrationRoutes);

const INTEGRATION_PATH = "/api/me/integrations/vikunja";

let d1: SqliteD1;
let env: Env;
let headers: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  ({ d1, env } = await setupVikunjaDb());
  seedVikunjaUser(d1);
  seedVikunjaConfig(d1);
  await seedSession(
    env as unknown as Record<string, unknown>,
    VIKUNJA_USER_ID,
    "s-1",
  );
  headers = cookieHeader(
    await makeToken("user", { sub: VIKUNJA_USER_ID, sid: "s-1" }),
  );
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function getIntegration(): Promise<{ status: number; body: any }> {
  return request(app, env, INTEGRATION_PATH, { headers });
}

function createIntegration(
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return request(app, env, INTEGRATION_PATH, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function updateIntegration(
  body: unknown,
): Promise<{ status: number; body: any }> {
  return request(app, env, INTEGRATION_PATH, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteIntegration(): Promise<{ status: number; body: any }> {
  return request(app, env, INTEGRATION_PATH, { method: "DELETE", headers });
}

function regenerateSecret(): Promise<{ status: number; body: any }> {
  return request(app, env, `${INTEGRATION_PATH}/regenerate-secret`, {
    method: "POST",
    headers,
  });
}

async function deliver(
  hookToken: string,
  rawBody: string,
  secret: string,
): Promise<{ status: number; body: any }> {
  return request(app, env, `/api/integrations/vikunja/${hookToken}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Vikunja-Signature": await signVikunjaBody(secret, rawBody),
    },
    body: rawBody,
  });
}

function reminderBody(): string {
  return JSON.stringify({
    event_name: "task.reminder.fired",
    time: "2026-11-05T01:30:00Z",
    data: {
      task: {
        id: 42,
        title: "买牛奶",
        due_date: "2026-11-05T01:30:00Z",
        project_id: 7,
      },
      user: { id: 1 },
      project: { id: 7, title: "家务" },
      reminder: { reminder: "2026-11-05T00:00:00Z" },
    },
  });
}

describe("GET /api/me/integrations/vikunja", () => {
  it("reports configured:false before anything is created", async () => {
    const res = await getIntegration();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it("requires a login session", async () => {
    const res = await request(app, env, INTEGRATION_PATH, {});
    expect(res.status).toBe(401);
  });
});

describe("POST /api/me/integrations/vikunja", () => {
  it("returns the hook token and the plaintext secret exactly once", async () => {
    const created = await createIntegration();
    expect(created.status).toBe(201);
    expect(created.body.hook_token).toMatch(/^vhk_[A-Za-z0-9_-]{43}$/);
    expect(created.body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body).toMatchObject({ base_url: "", enabled: true });

    const view = await getIntegration();
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      configured: true,
      hook_token: created.body.hook_token,
      base_url: "",
      enabled: true,
      secret_configured: true,
    });
    expect(view.body).not.toHaveProperty("secret");
    expect(JSON.stringify(view.body)).not.toContain(created.body.secret);
    expect(view.body.created_at).toBeTypeOf("string");
    expect(view.body.updated_at).toBeTypeOf("string");

    // The create body is the GET view plus the one-time secret.
    const { secret: _secret, ...createdView } = created.body;
    expect(createdView).toEqual(view.body);
  });

  it("accepts base_url, trims trailing slashes and rejects non-http(s)", async () => {
    const invalid = await createIntegration({
      base_url: "ftp://vikunja.local",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: "Invalid base_url" });
    expect((await getIntegration()).body).toEqual({ configured: false });

    const created = await createIntegration({
      base_url: "https://vikunja.example.com/",
    });
    expect(created.status).toBe(201);
    expect(created.body.base_url).toBe("https://vikunja.example.com");
    expect((await getIntegration()).body.base_url).toBe(
      "https://vikunja.example.com",
    );
  });

  it("rejects a second creation with 409", async () => {
    expect((await createIntegration()).status).toBe(201);
    const duplicate = await createIntegration();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "Integration already exists" });
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app, env, INTEGRATION_PATH, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/me/integrations/vikunja", () => {
  it("updates base_url and enabled with validation", async () => {
    await createIntegration();

    const invalidUrl = await updateIntegration({
      base_url: "mailto:me@example.com",
    });
    expect(invalidUrl.status).toBe(400);
    expect(invalidUrl.body).toEqual({ error: "Invalid base_url" });

    const savedUrl = await updateIntegration({
      base_url: "http://vikunja.internal:3456/",
    });
    expect(savedUrl.status).toBe(200);
    expect(savedUrl.body.base_url).toBe("http://vikunja.internal:3456");

    const disabled = await updateIntegration({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect((await getIntegration()).body.enabled).toBe(false);

    const enabled = await updateIntegration({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    expect((await getIntegration()).body.base_url).toBe(
      "http://vikunja.internal:3456",
    );

    const badEnabled = await updateIntegration({ enabled: "yes" });
    expect(badEnabled.status).toBe(400);

    const empty = await updateIntegration({});
    expect(empty.status).toBe(400);
  });

  it("returns 404 before the integration exists", async () => {
    const res = await updateIntegration({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/me/integrations/vikunja/regenerate-secret", () => {
  it("rotates the secret: the old signature fails, the new one passes", async () => {
    const created = await createIntegration();
    const { hook_token: hookToken } = created.body;
    const oldSecret = created.body.secret as string;
    const rawBody = reminderBody();

    const before = await deliver(hookToken, rawBody, oldSecret);
    expect(before.status).toBe(200);

    const rotated = await regenerateSecret();
    expect(rotated.status).toBe(200);
    const newSecret = rotated.body.secret as string;
    expect(newSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret).not.toBe(oldSecret);
    expect(JSON.stringify(rotated.body)).not.toContain(oldSecret);

    const withOld = await deliver(hookToken, rawBody, oldSecret);
    expect(withOld.status).toBe(401);
    expect(withOld.body).toEqual({ error: "Invalid signature" });

    const withNew = await deliver(hookToken, rawBody, newSecret);
    expect(withNew.status).toBe(200);
    expect(withNew.body).toEqual({
      success: true,
      results: [{ channel: "telegram", success: true }],
    });

    const history = d1.db
      .prepare(
        `SELECT trigger_source FROM ${VIKUNJA_PREFIX}notification_history`,
      )
      .all() as { trigger_source: string }[];
    expect(history).toHaveLength(2);
    expect(history.every((row) => row.trigger_source === "vikunja")).toBe(true);
  });

  it("returns 404 before the integration exists", async () => {
    const res = await regenerateSecret();
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/me/integrations/vikunja", () => {
  it("deletes the integration and the inbound endpoint stops accepting it", async () => {
    const created = await createIntegration();
    const { hook_token: hookToken } = created.body;
    const rawBody = reminderBody();
    expect(
      (await deliver(hookToken, rawBody, created.body.secret)).status,
    ).toBe(200);

    const deleted = await deleteIntegration();
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect((await getIntegration()).body).toEqual({ configured: false });

    const inbound = await deliver(hookToken, rawBody, created.body.secret);
    expect(inbound.status).toBe(404);
    expect(inbound.body).toEqual({ error: "Not found" });

    const again = await deleteIntegration();
    expect(again.status).toBe(404);
  });

  it("returns 404 before the integration exists", async () => {
    const res = await deleteIntegration();
    expect(res.status).toBe(404);
  });
});

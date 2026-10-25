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

const ME_PATHS = ["/api/me/export", "/api/me/import/preview", "/api/me/import"];
const ADMIN_PATHS = [
  "/api/admin/export",
  "/api/admin/import/preview",
  "/api/admin/import",
];

function seededEnv() {
  const db = new SqliteD1();
  seedInstance(db);
  return { db, env: makeBackupEnv(db) };
}

describe("session requirements", () => {
  it.each([...ME_PATHS, ...ADMIN_PATHS])(
    "rejects an unauthenticated request to %s with 401",
    async (path) => {
      const { env } = seededEnv();
      const res = await callWorker(env, path, jsonPost({}));
      expect(res.status).toBe(401);
    },
  );

  it.each(ADMIN_PATHS)(
    "rejects a non-admin session on %s with 403",
    async (path) => {
      const { env } = seededEnv();
      const res = await callWorker(
        env,
        path,
        jsonPost({}, await userCookie(env)),
      );
      expect(res.status).toBe(403);
    },
  );

  it("rejects an API key even when a valid session cookie is present", async () => {
    const { env } = seededEnv();
    const cookie = await adminCookie(env);
    const headers = { ...cookie, Authorization: "Bearer enk_live_key_123" };

    const me = await callWorker(env, "/api/me/export", jsonPost({}, headers));
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("API_KEY_NOT_ALLOWED");

    const admin = await callWorker(
      env,
      "/api/admin/export",
      jsonPost({}, headers),
    );
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe("API_KEY_NOT_ALLOWED");
  });

  it("rejects an API-key bearer on the import endpoints too", async () => {
    const { env } = seededEnv();
    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost(
        { file: {} },
        {
          ...(await adminCookie(env)),
          Authorization: "Bearer enk_another_key",
        },
      ),
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("API_KEY_NOT_ALLOWED");
  });
});

describe("request hardening", () => {
  it("rejects an upload larger than 10 MB with 413", async () => {
    const { env } = seededEnv();
    const huge = "x".repeat(10 * 1024 * 1024 + 16);
    const res = await callWorker(
      env,
      "/api/admin/import",
      jsonPost({ file: huge }, await adminCookie(env)),
    );
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(res.body.details.max_bytes).toBe(10 * 1024 * 1024);
  });

  it("rejects a non-JSON request body with 400", async () => {
    const { env } = seededEnv();
    const res = await callWorker(env, "/api/me/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await userCookie(env)),
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("rejects a request without a file field", async () => {
    const { env } = seededEnv();
    const res = await callWorker(
      env,
      "/api/me/import/preview",
      jsonPost({ passphrase: "pw" }, await userCookie(env)),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
    expect(res.body.error).toContain("file");
  });

  it("accepts the file as raw JSON text as well as a parsed object", async () => {
    const { db, env } = seededEnv();
    const exported = await callWorker(
      env,
      "/api/admin/export",
      jsonPost({ encrypted: false }, await adminCookie(env)),
    );

    const asText = await callWorker(
      env,
      "/api/admin/import/preview",
      jsonPost({ file: JSON.stringify(exported.body) }, await adminCookie(env)),
    );
    expect(asText.status).toBe(200);
    expect(asText.body.can_execute).toBe(false); // non-empty target
    expect(db.count("users")).toBe(3);
  });
});

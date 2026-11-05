import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationRoutes } from "../src/routes/integrations";
import type { Env } from "../src/types";
import { request } from "./helpers";
import type { SqliteD1 } from "./support/sqlite-d1";
import {
  VIKUNJA_PREFIX,
  VIKUNJA_USER_ID,
  seedVikunjaConfig,
  seedVikunjaIntegration,
  seedVikunjaUser,
  setVikunjaIntegration,
  setupVikunjaDb,
  signVikunjaBody,
} from "./support/vikunja";

const app = new Hono();
app.route("/api/integrations", integrationRoutes);

let d1: SqliteD1;
let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  ({ d1, env } = await setupVikunjaDb());
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function webhookBody(event: string, data: unknown): string {
  return JSON.stringify({
    event_name: event,
    time: "2026-11-05T01:30:00Z",
    data,
  });
}

function taskPayload() {
  return {
    task: {
      id: 42,
      title: "买牛奶",
      due_date: "2026-11-05T01:30:00Z",
      project_id: 7,
    },
    user: { id: 1 },
    project: { id: 7, title: "家务" },
    reminder: { reminder: "2026-11-05T00:00:00Z" },
  };
}

function post(
  hookToken: string,
  rawBody: string,
  signature: string | null,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== null) headers["X-Vikunja-Signature"] = signature;
  return request(app, env, `/api/integrations/vikunja/${hookToken}`, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

async function deliver(
  hookToken: string,
  rawBody: string,
  secret: string,
): Promise<{ status: number; body: any }> {
  return post(hookToken, rawBody, await signVikunjaBody(secret, rawBody));
}

/** User + notification config + enabled integration, i.e. the happy path. */
function seedReady(opts: { defaultChannel?: string } = {}) {
  seedVikunjaUser(d1);
  seedVikunjaConfig(d1, { defaultChannel: opts.defaultChannel });
  return seedVikunjaIntegration(d1);
}

function historyRows(): Record<string, unknown>[] {
  return d1.db
    .prepare(`SELECT * FROM ${VIKUNJA_PREFIX}notification_history`)
    .all() as Record<string, unknown>[];
}

describe("POST /api/integrations/vikunja/:hookToken", () => {
  it("answers an unknown hook token with 404", async () => {
    const res = await deliver(
      "vhk_does_not_exist",
      webhookBody("task.reminder.fired", taskPayload()),
      "any-secret",
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a disabled integration with 403 and sends nothing", async () => {
    seedVikunjaUser(d1);
    seedVikunjaConfig(d1);
    const { hookToken, secret } = seedVikunjaIntegration(d1, {
      enabled: false,
    });

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Integration disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(historyRows()).toHaveLength(0);
  });

  it("rejects a wrong, tampered or missing signature with 401", async () => {
    const { hookToken, secret } = seedReady();
    const rawBody = webhookBody("task.reminder.fired", taskPayload());

    const wrongSecret = await deliver(hookToken, rawBody, "not-the-secret");
    const tampered = await post(
      hookToken,
      rawBody,
      await signVikunjaBody(secret, `${rawBody} `),
    );
    const missing = await post(hookToken, rawBody, null);
    const malformed = await post(hookToken, rawBody, "deadbeef");

    for (const res of [wrongSecret, tampered, missing, malformed]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Invalid signature" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(historyRows()).toHaveLength(0);
  });

  it("sends a reminder through the default channel and records trigger_source=vikunja", async () => {
    const { hookToken, secret } = seedReady();
    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      results: [{ channel: "telegram", success: true }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "api.telegram.org/botbot-token/sendMessage",
    );

    const history = historyRows();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      user_id: VIKUNJA_USER_ID,
      item_id: null,
      channel: "telegram",
      title: "⏰ 买牛奶",
      success: 1,
      error: null,
      trigger_source: "vikunja",
    });
    // Due date rendered in the receiving user's timezone (Asia/Shanghai).
    expect(history[0].body).toBe("项目：家务\n截止：2026-11-05 09:30");

    // The integration only sends: no eNotify items are created.
    const itemCount = d1.db
      .prepare(`SELECT COUNT(*) AS count FROM ${VIKUNJA_PREFIX}items`)
      .get() as { count: number };
    expect(itemCount.count).toBe(0);
  });

  it("returns 400 and sends nothing when no default channel is configured", async () => {
    const { hookToken, secret } = seedReady({ defaultChannel: "" });

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No default channel configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(historyRows()).toHaveLength(0);
  });

  it("returns 400 and sends nothing when the user has no channel config", async () => {
    seedVikunjaUser(d1);
    const { hookToken, secret } = seedVikunjaIntegration(d1);

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "No notification channels configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers an unknown event with 200 {ignored:true} and sends nothing", async () => {
    const { hookToken, secret } = seedReady();

    const res = await deliver(
      hookToken,
      webhookBody("task.created", { task: { id: 1, title: "x" } }),
      secret,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(historyRows()).toHaveLength(0);
  });

  it("answers an incomplete known event with 200 {ignored:true}, logs and sends nothing", async () => {
    const { hookToken, secret } = seedReady();
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await deliver(
      hookToken,
      webhookBody("task.overdue", { task: { id: 42 } }),
      secret,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: true });
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(String(errorMock.mock.calls[0][0])).toContain("task.overdue");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 when the owning user is disabled", async () => {
    seedVikunjaUser(d1, { isActive: false });
    seedVikunjaConfig(d1);
    const { hookToken, secret } = seedVikunjaIntegration(d1);

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a signed body that is not JSON or has no event_name", async () => {
    const { hookToken, secret } = seedReady();

    const notJson = await deliver(hookToken, "definitely not json", secret);
    expect(notJson.status).toBe(400);

    const noEventName = await deliver(
      hookToken,
      JSON.stringify({ data: taskPayload() }),
      secret,
    );
    expect(noEventName.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not apply notification_hours gating", async () => {
    const currentHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "hour")?.value ?? "0",
    );
    const otherHour = (currentHour + 1) % 24;

    seedVikunjaUser(d1);
    seedVikunjaConfig(d1, {
      notificationHours: JSON.stringify([otherHour]),
    });
    const { hookToken, secret } = seedVikunjaIntegration(d1);

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits per hook token at 60 requests per minute", async () => {
    seedVikunjaUser(d1);
    seedVikunjaConfig(d1);
    const { hookToken, secret } = seedVikunjaIntegration(d1);
    const rawBody = webhookBody("task.reminder.fired", taskPayload());
    const signature = await signVikunjaBody(secret, rawBody);

    for (let index = 0; index < 60; index += 1) {
      const res = await post(hookToken, rawBody, signature);
      expect(res.status).toBe(200);
    }
    const limited = await post(hookToken, rawBody, signature);
    expect(limited.status).toBe(429);
  });

  it("stops delivering once the integration is deleted", async () => {
    const { hookToken, secret } = seedReady();
    d1.db
      .prepare(
        `DELETE FROM ${VIKUNJA_PREFIX}vikunja_integrations WHERE hook_token = ?`,
      )
      .run(hookToken);

    const res = await deliver(
      hookToken,
      webhookBody("task.reminder.fired", taskPayload()),
      secret,
    );
    expect(res.status).toBe(404);
  });
});

describe("inbound route respects base_url changes", () => {
  it("uses the stored base_url in the task link after an update", async () => {
    seedVikunjaUser(d1);
    seedVikunjaConfig(d1, { defaultChannel: "bark" });
    const { hookToken, secret } = seedVikunjaIntegration(d1, {
      baseUrl: "https://vikunja.old",
    });
    setVikunjaIntegration(d1, { base_url: "https://vikunja.internal" });

    const res = await deliver(
      hookToken,
      webhookBody("task.overdue", taskPayload()),
      secret,
    );
    expect(res.status).toBe(200);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      url?: string;
    };
    expect(sent.url).toBe("https://vikunja.internal/tasks/42");
  });
});

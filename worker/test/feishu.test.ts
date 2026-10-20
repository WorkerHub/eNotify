import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendFeishu, signFeishu } from "../src/services/notify/feishu";
import type { Env } from "../src/types";

const WEBHOOK_URL =
  "https://open.feishu.cn/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000";
const LARK_WEBHOOK_URL =
  "https://open.larksuite.com/open-apis/bot/v2/hook/00000000-0000-0000-0000-000000000000";

function makeEnv(): Env {
  return {} as Env;
}

function okResponse(body: unknown = { code: 0, msg: "success" }): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("signFeishu", () => {
  it("matches the official HMAC-SHA256(timestamp\\nsecret, empty message) algorithm", async () => {
    const timestamp = 1700000000;
    const secret = "feishu-secret";

    const expected = createHmac("sha256", `${timestamp}\n${secret}`)
      .update("")
      .digest("base64");

    await expect(signFeishu(timestamp, secret)).resolves.toBe(expected);
  });
});

describe("sendFeishu", () => {
  it("posts a text message with title, body and url and omits the signature without a secret", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      {
        title: "Renewal due",
        body: "Your plan expires soon.",
        url: "https://enotify.example.com/items/1",
      },
      makeEnv(),
    );

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const payload = JSON.parse(String(init.body));
    expect(payload).toEqual({
      msg_type: "text",
      content: {
        text: "Renewal due\nYour plan expires soon.\nhttps://enotify.example.com/items/1",
      },
    });
  });

  it("omits the url line when message.url is empty", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).content.text).toBe("Title\nBody");
  });

  it("signs the request with the configured secret and the current timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000 * 1000));

    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const secret = "feishu-secret";
    await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL, secret }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));
    expect(payload.timestamp).toBe("1700000000");
    expect(payload.sign).toBe(
      createHmac("sha256", `1700000000\n${secret}`).update("").digest("base64"),
    );
  });

  it("accepts the international Lark domain", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: LARK_WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects other hosts without fetching", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({
        webhook_url: "https://example.com/open-apis/bot/v2/hook/abc",
      }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("open.feishu.cn");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a Feishu URL with the wrong path without fetching", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({
        webhook_url: "https://open.feishu.cn/open-apis/bot/v2",
      }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("/open-apis/bot/v2/hook/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails without fetching when webhook_url is missing", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: "" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("webhook URL required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the API answers 200 with a non-zero code", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 19002, msg: "sign match fail" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("19002");
    expect(result.error).toContain("sign match fail");
  });

  it("fails when the response body is not JSON", async () => {
    const fetchMock = vi.fn(
      async () => new Response("not json", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("invalid response body");
  });

  it("reports the status code when the API returns an error", async () => {
    const fetchMock = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendFeishu(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
    expect(result.error).toContain("bad request");
  });
});

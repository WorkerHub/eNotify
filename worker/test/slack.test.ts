import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSlack } from "../src/services/notify/slack";
import type { Env } from "../src/types";

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";

function makeEnv(): Env {
  return {} as Env;
}

function okResponse(): Response {
  return new Response("ok", { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendSlack", () => {
  it("posts a JSON body with title, body and url to the configured webhook", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlack(
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
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const payload = JSON.parse(String(init.body));
    expect(payload.text).toBe(
      "_Renewal due_\nYour plan expires soon.\nhttps://enotify.example.com/items/1",
    );
  });

  it("omits the url line when message.url is empty", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendSlack(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).text).toBe("_Title_\nBody");
  });

  it("escapes quotes, backslashes and newlines so the text round-trips", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const title = 'Say "hi" \\ now';
    const body = 'line 1\nline 2 with "quotes" and \\backslash\\';
    const url = "https://enotify.example.com/items/1?a=1&b=2";

    await sendSlack(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title, body, url },
      makeEnv(),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const rawBody = String(init.body);
    expect(() => JSON.parse(rawBody)).not.toThrow();
    expect(JSON.parse(rawBody).text).toBe(`_${title}_\n${body}\n${url}`);
  });

  it("fails without fetching when webhook_url is missing", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlack(
      JSON.stringify({ webhook_url: "" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("webhook URL required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a URL that is not on hooks.slack.com without fetching", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlack(
      JSON.stringify({ webhook_url: "https://example.com/hook" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("hooks.slack.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private/internal URLs without fetching", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlack(
      JSON.stringify({ webhook_url: "https://127.0.0.1/hook" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the status code when Slack returns an error", async () => {
    const fetchMock = vi.fn(
      async () => new Response("invalid_payload", { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSlack(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("400");
    expect(result.error).toContain("invalid_payload");
  });
});

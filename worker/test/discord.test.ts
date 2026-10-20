import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDiscord } from "../src/services/notify/discord";
import type { Env } from "../src/types";

const WEBHOOK_URL =
  "https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz";
const LEGACY_WEBHOOK_URL =
  "https://discordapp.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz";

function makeEnv(): Env {
  return {} as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendDiscord", () => {
  it("posts a bold title, body and url and succeeds on HTTP 204", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
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
    expect(JSON.parse(String(init.body))).toEqual({
      content:
        "**Renewal due**\nYour plan expires soon.\nhttps://enotify.example.com/items/1",
    });
  });

  it("omits the url line when message.url is empty and accepts HTTP 200", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result).toEqual({ success: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).content).toBe("**Title**\nBody");
  });

  it("accepts the legacy discordapp.com domain", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: LEGACY_WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects other hosts without fetching", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({
        webhook_url: "https://example.com/api/webhooks/1/abc",
      }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("discord.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a Discord URL with the wrong path without fetching", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: "https://discord.com/channels/1/2" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("/api/webhooks/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails without fetching when webhook_url is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: "" }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("webhook URL required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates content to 2000 characters without splitting multi-byte characters", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = "😀中文".repeat(1000);
    await sendDiscord(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body },
      makeEnv(),
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const content = JSON.parse(String(init.body)).content as string;
    expect(Array.from(content)).toHaveLength(2000);
    // encodeURIComponent throws on a lone surrogate, so this proves the cut
    // never landed in the middle of an emoji's surrogate pair.
    expect(() => encodeURIComponent(content)).not.toThrow();
    expect(content).toBe(
      Array.from(`**Title**\n${body}`).slice(0, 2000).join(""),
    );
  });

  it("fails on HTTP 500 and reports the status and body", async () => {
    const fetchMock = vi.fn(
      async () => new Response("server error", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
    expect(result.error).toContain("server error");
  });

  it("fails on HTTP 429 without retrying", async () => {
    const fetchMock = vi.fn(
      async () => new Response("rate limited", { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendDiscord(
      JSON.stringify({ webhook_url: WEBHOOK_URL }),
      { title: "Title", body: "Body" },
      makeEnv(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
    expect(result.error).toContain("rate limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

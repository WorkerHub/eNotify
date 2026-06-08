import type { NotifyMessage } from "./index";
import type { Env } from "../../types";

interface WebhookConfig {
  url: string;
  method?: string;
  headers?: string;
  template?: string;
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  )
    return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal"))
    return true;

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map(Number);
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 0) return true;
  }

  return false;
}

export async function sendWebhook(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: WebhookConfig = JSON.parse(configJson);
  if (!config.url) {
    return { success: false, error: "Webhook URL required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(config.url);
  } catch {
    return { success: false, error: "Invalid webhook URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { success: false, error: "Only HTTP(S) URLs are allowed" };
  }

  if (isPrivateHostname(parsed.hostname)) {
    return {
      success: false,
      error: "Webhook URL must not point to private/internal addresses",
    };
  }

  const method = config.method || "POST";
  let headers: Record<string, string> = {};
  if (config.headers) {
    try {
      headers = JSON.parse(config.headers);
    } catch {
      /* ignore invalid headers */
    }
  }
  headers["Content-Type"] = headers["Content-Type"] || "application/json";

  let body: string;
  if (config.template) {
    body = config.template
      .replace(/\{\{title\}\}/g, message.title)
      .replace(/\{\{body\}\}/g, message.body)
      .replace(/\{\{url\}\}/g, message.url || "");
  } else {
    body = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
    });
  }

  const response = await fetch(config.url, { method, headers, body });

  if (!response.ok) {
    const err = await response.text();
    return {
      success: false,
      error: `Webhook error (${response.status}): ${err}`,
    };
  }

  return { success: true };
}

import type { Env } from "../../types";
import type { NotifyMessage } from "./index";
import { safeErrorText, validateOutboundUrl } from "./safe-fetch";

interface FeishuConfig {
  webhook_url: string;
  secret?: string;
}

const FEISHU_HOSTS = new Set(["open.feishu.cn", "open.larksuite.com"]);
const FEISHU_HOOK_PATH = "/open-apis/bot/v2/hook/";

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Feishu/Lark custom bot signature: HMAC-SHA256 whose *key* is
 * `${timestamp}\n${secret}` and whose message is the empty string, Base64
 * encoded. (See the official "custom bot security settings" docs.)
 */
export async function signFeishu(
  timestamp: number | string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${timestamp}\n${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(""));
  return toBase64(signature);
}

export async function sendFeishu(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: FeishuConfig = JSON.parse(configJson);
  if (!config.webhook_url) {
    return { success: false, error: "Feishu webhook URL required" };
  }

  const check = validateOutboundUrl(config.webhook_url);
  if (check.error || !check.url) {
    return { success: false, error: `Feishu: ${check.error ?? "Invalid URL"}` };
  }
  if (!FEISHU_HOSTS.has(check.url.hostname)) {
    return {
      success: false,
      error:
        "Feishu: webhook URL must be on open.feishu.cn or open.larksuite.com",
    };
  }
  if (!check.url.pathname.startsWith(FEISHU_HOOK_PATH)) {
    return {
      success: false,
      error: `Feishu: webhook URL path must start with ${FEISHU_HOOK_PATH}`,
    };
  }

  const lines = [message.title, message.body];
  if (message.url) lines.push(message.url);
  const text = lines.join("\n");

  const payload: Record<string, unknown> = {
    msg_type: "text",
    content: { text },
  };
  if (config.secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = await signFeishu(timestamp, config.secret);
  }

  const response = await fetch(config.webhook_url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await safeErrorText(response);
    return {
      success: false,
      error: `Feishu error (${response.status}): ${err}`,
    };
  }

  // The bot API answers HTTP 200 even when the business call fails; `code`
  // distinguishes the two, so the body has to be inspected.
  let data: { code?: number; msg?: string };
  try {
    data = await response.json();
  } catch {
    return { success: false, error: "Feishu error: invalid response body" };
  }
  if (data.code !== undefined && data.code !== 0) {
    const msg = String(data.msg ?? "").slice(0, 200);
    return {
      success: false,
      error: `Feishu error (code ${data.code}): ${msg}`,
    };
  }
  return { success: true };
}

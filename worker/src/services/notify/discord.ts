import type { Env } from "../../types";
import type { NotifyMessage } from "./index";
import { safeErrorText, validateOutboundUrl } from "./safe-fetch";

interface DiscordConfig {
  webhook_url: string;
}

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);
const DISCORD_WEBHOOK_PATH = "/api/webhooks/";
const DISCORD_CONTENT_LIMIT = 2000;

export async function sendDiscord(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: DiscordConfig = JSON.parse(configJson);
  if (!config.webhook_url) {
    return { success: false, error: "Discord webhook URL required" };
  }

  const check = validateOutboundUrl(config.webhook_url);
  if (check.error || !check.url) {
    return {
      success: false,
      error: `Discord: ${check.error ?? "Invalid URL"}`,
    };
  }
  if (!DISCORD_HOSTS.has(check.url.hostname)) {
    return {
      success: false,
      error: "Discord: webhook URL must be on discord.com or discordapp.com",
    };
  }
  if (!check.url.pathname.startsWith(DISCORD_WEBHOOK_PATH)) {
    return {
      success: false,
      error: `Discord: webhook URL path must start with ${DISCORD_WEBHOOK_PATH}`,
    };
  }

  const lines = [`**${message.title}**`, message.body];
  if (message.url) lines.push(message.url);
  // Discord caps `content` at 2000 characters. Slice by code point so
  // multi-byte characters and surrogate pairs are never split in half.
  const content = Array.from(lines.join("\n"))
    .slice(0, DISCORD_CONTENT_LIMIT)
    .join("");

  const response = await fetch(config.webhook_url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (response.status !== 200 && response.status !== 204) {
    const err = await safeErrorText(response);
    return {
      success: false,
      error: `Discord error (${response.status}): ${err}`,
    };
  }
  return { success: true };
}

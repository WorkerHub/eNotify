import type { Env } from "../../types";
import type { NotifyMessage } from "./index";
import { safeErrorText, validateOutboundUrl } from "./safe-fetch";

interface SlackConfig {
  webhook_url: string;
}

export async function sendSlack(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: SlackConfig = JSON.parse(configJson);
  if (!config.webhook_url) {
    return { success: false, error: "Slack webhook URL required" };
  }

  const check = validateOutboundUrl(config.webhook_url);
  if (check.error || !check.url) {
    return { success: false, error: `Slack: ${check.error ?? "Invalid URL"}` };
  }
  if (check.url.hostname !== "hooks.slack.com") {
    return {
      success: false,
      error: "Slack: webhook URL must be on hooks.slack.com",
    };
  }

  const lines = [`_${message.title}_`, message.body];
  if (message.url) lines.push(message.url);
  const text = lines.join("\n");

  const response = await fetch(config.webhook_url, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const err = await safeErrorText(response);
    return {
      success: false,
      error: `Slack error (${response.status}): ${err}`,
    };
  }
  return { success: true };
}

import type { NotifyMessage } from "./index";
import type { Env } from "../../types";

interface PushPlusConfig {
  token: string;
  topic?: string;
  channel?: string;
}

export async function sendPushPlus(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: PushPlusConfig = JSON.parse(configJson);
  if (!config.token) {
    return { success: false, error: "PushPlus token required" };
  }

  const body: Record<string, string> = {
    token: config.token,
    title: message.title,
    content: message.body,
  };

  if (config.topic) body.topic = config.topic;
  if (config.channel) body.channel = config.channel;

  const response = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `PushPlus error: ${err}` };
  }

  return { success: true };
}

import type { NotifyMessage } from "./index";
import type { Env } from "../../types";

interface BarkConfig {
  device_key: string;
  server?: string;
  is_archive?: boolean;
}

export async function sendBark(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: BarkConfig = JSON.parse(configJson);
  if (!config.device_key) {
    return { success: false, error: "Bark device key required" };
  }

  const server = config.server || "https://api.day.app";
  const url = `${server.replace(/\/$/, "")}/${config.device_key}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
      isArchive: config.is_archive ? 1 : 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Bark error: ${err}` };
  }

  return { success: true };
}

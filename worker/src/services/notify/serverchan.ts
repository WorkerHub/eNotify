import type { NotifyMessage } from "./index";
import type { Env } from "../../types";

interface ServerChanConfig {
  sendkey: string;
}

export async function sendServerChan(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: ServerChanConfig = JSON.parse(configJson);
  if (!config.sendkey) {
    return { success: false, error: "ServerChan sendkey required" };
  }

  const response = await fetch(
    `https://sctapi.ftqq.com/${config.sendkey}.send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: message.title,
        desp: message.body,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `ServerChan error: ${err}` };
  }

  return { success: true };
}

import type { NotifyMessage } from "./index";
import type { Env } from "../../types";

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

export async function sendTelegram(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: TelegramConfig = JSON.parse(configJson);
  if (!config.bot_token || !config.chat_id) {
    return { success: false, error: "Telegram bot_token and chat_id required" };
  }

  const text = `*${escapeMarkdown(message.title)}*\n\n${escapeMarkdown(message.body)}`;

  const response = await fetch(
    `https://api.telegram.org/bot${config.bot_token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chat_id,
        text,
        parse_mode: "MarkdownV2",
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Telegram API error: ${err}` };
  }

  return { success: true };
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

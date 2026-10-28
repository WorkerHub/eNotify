import type { NotificationConfig } from "../../types";
import { sendTelegram } from "./telegram";
import { sendWebhook } from "./webhook";
import { sendWechatBot } from "./wechatbot";
import { sendBark } from "./bark";
import { sendSlack } from "./slack";
import { sendFeishu } from "./feishu";
import { sendDiscord } from "./discord";
import { sendNotifyEmail } from "./email-notify";
import type { Env } from "../../types";
import { insertNotificationHistory } from "../../db/queries/notification-history";
import { generateId } from "../../core/auth";

export interface NotifyMessage {
  title: string;
  body: string;
  url?: string;
}

export interface NotifyResult {
  channel: string;
  success: boolean;
  error?: string;
}

export interface NotifyContext {
  db: D1Database;
  prefix: string;
  userId: string;
  itemId?: string | null;
  /** Why this notification was sent: "item", "api" or "test". */
  triggerSource?: string;
}

const CHANNEL_SENDERS: Record<
  string,
  (
    config: string,
    message: NotifyMessage,
    env: Env,
  ) => Promise<{ success: boolean; error?: string }>
> = {
  telegram: sendTelegram,
  webhook: sendWebhook,
  wechatbot: sendWechatBot,
  email: sendNotifyEmail,
  bark: sendBark,
  slack: sendSlack,
  feishu: sendFeishu,
  discord: sendDiscord,
};

const SEND_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, channel: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`${channel} timed out after ${SEND_TIMEOUT_MS}ms`)),
      SEND_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function recordHistory(
  context: NotifyContext,
  channel: string,
  title: string,
  body: string | null,
  success: boolean,
  error?: string | null,
): Promise<void> {
  try {
    await insertNotificationHistory(context.db, context.prefix, {
      id: generateId(),
      user_id: context.userId,
      item_id: context.itemId,
      channel,
      title,
      body,
      success,
      error,
      trigger_source: context.triggerSource ?? null,
    });
  } catch (err) {
    console.error("Failed to insert notification history:", err);
  }
}

export async function sendNotifications(
  config: NotificationConfig,
  message: NotifyMessage,
  env: Env,
  context?: NotifyContext,
  channels?: string[],
): Promise<NotifyResult[]> {
  let enabledChannels: string[];
  try {
    enabledChannels = JSON.parse(config.enabled_channels || "[]");
  } catch {
    enabledChannels = [];
  }

  let targetChannels: string[];
  // If specific channels are requested, intersect with enabled channels
  if (channels && channels.length > 0) {
    targetChannels = enabledChannels.filter((ch) => channels.includes(ch));
    if (targetChannels.length === 0) {
      throw new Error("None of the requested channels are enabled");
    }
  } else {
    const defaultChannel = config.default_channel || "";
    if (defaultChannel === "") {
      throw new Error("No default channel configured");
    }
    if (!enabledChannels.includes(defaultChannel)) {
      throw new Error(`Default channel is not enabled: ${defaultChannel}`);
    }
    targetChannels = [defaultChannel];
  }

  const results: NotifyResult[] = [];

  for (const channel of targetChannels) {
    const sender = CHANNEL_SENDERS[channel];
    if (!sender) {
      results.push({ channel, success: false, error: "Unknown channel" });
      if (context) {
        await recordHistory(
          context,
          channel,
          message.title,
          message.body,
          false,
          "Unknown channel",
        );
      }
      continue;
    }

    const configKey = `${channel}_config` as keyof NotificationConfig;
    const channelConfig = (config[configKey] as string) || "{}";

    let result: { success: boolean; error?: string };
    try {
      result = await withTimeout(sender(channelConfig, message, env), channel);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push({ channel, ...result });

    if (context) {
      await recordHistory(
        context,
        channel,
        message.title,
        message.body,
        result.success,
        result.error,
      );
    }
  }

  return results;
}

export async function sendToChannel(
  channel: string,
  configJson: string,
  message: NotifyMessage,
  env: Env,
): Promise<{ success: boolean; error?: string }> {
  const sender = CHANNEL_SENDERS[channel];
  if (!sender) return { success: false, error: "Unknown channel" };
  try {
    return await withTimeout(sender(configJson, message, env), channel);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

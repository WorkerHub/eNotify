import type { NotificationConfig } from "../../types";
import { sendTelegram } from "./telegram";
import { sendWebhook } from "./webhook";
import { sendWechatBot } from "./wechatbot";
import { sendBark } from "./bark";
import { sendGotify } from "./gotify";
import { sendServerChan } from "./serverchan";
import { sendPushPlus } from "./pushplus";
import { sendNotifyX } from "./notifyx";
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
  gotify: sendGotify,
  serverchan: sendServerChan,
  pushplus: sendPushPlus,
  notifyx: sendNotifyX,
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

  // If specific channels are requested, intersect with enabled channels
  if (channels && channels.length > 0) {
    enabledChannels = enabledChannels.filter((ch) => channels.includes(ch));
  }

  const results: NotifyResult[] = [];

  for (const channel of enabledChannels) {
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

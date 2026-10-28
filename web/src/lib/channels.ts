export const CHANNELS = [
  { id: "telegram", label: "Telegram" },
  { id: "webhook", label: "Webhook" },
  { id: "wechatbot", label: "WeCom Bot" },
  { id: "email", label: "Email" },
  { id: "bark", label: "Bark" },
  { id: "slack", label: "Slack" },
  { id: "feishu", label: "Lark Bot" },
  { id: "discord", label: "Discord" },
] as const;

/**
 * Friendly label for a channel id. Unknown ids (retired channels, or names
 * written by another build) fall back to the id itself so nothing is hidden.
 */
export function getChannelLabel(id: string): string {
  return CHANNELS.find((channel) => channel.id === id)?.label ?? id;
}

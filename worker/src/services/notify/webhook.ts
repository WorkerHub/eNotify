import type { NotifyMessage } from "./index";
import type { Env } from "../../types";
import { validateOutboundUrl, safeErrorText } from "./safe-fetch";

interface WebhookConfig {
  url: string;
  method?: string;
  headers?: string;
  template?: string;
}

export async function sendWebhook(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: WebhookConfig = JSON.parse(configJson);
  if (!config.url) {
    return { success: false, error: "Webhook URL required" };
  }

  const check = validateOutboundUrl(config.url);
  if (check.error) {
    return { success: false, error: `Webhook: ${check.error}` };
  }

  const method = config.method || "POST";
  let headers: Record<string, string> = {};
  if (config.headers) {
    try {
      headers = JSON.parse(config.headers);
    } catch {
      /* ignore invalid headers */
    }
  }
  headers["Content-Type"] = headers["Content-Type"] || "application/json";

  let body: string;
  if (config.template) {
    body = config.template
      .replace(/\{\{title\}\}/g, message.title)
      .replace(/\{\{body\}\}/g, message.body)
      .replace(/\{\{url\}\}/g, message.url || "");
  } else {
    body = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
    });
  }

  const response = await fetch(config.url, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  if (!response.ok) {
    const err = await safeErrorText(response);
    return {
      success: false,
      error: `Webhook error (${response.status}): ${err}`,
    };
  }

  return { success: true };
}

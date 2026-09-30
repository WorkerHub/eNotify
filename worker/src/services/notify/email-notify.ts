import type { NotifyMessage } from "./index";
import type { Env } from "../../types";
import { sendEmail } from "../email";

interface EmailNotifyConfig {
  to: string;
  from_name?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendNotifyEmail(
  configJson: string,
  message: NotifyMessage,
  env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: EmailNotifyConfig = JSON.parse(configJson);
  if (!config.to) {
    return { success: false, error: "Email recipient required" };
  }

  if (/[\r\n,;<>]/.test(config.to)) {
    return { success: false, error: "Invalid email recipient" };
  }

  const safeTitle = escapeHtml(message.title);
  const safeBody = escapeHtml(message.body).replace(/\n/g, "<br>");

  return sendEmail(env, {
    to: config.to,
    subject: message.title.replace(/[\r\n]+/g, " "),
    html: `<h2>${safeTitle}</h2><p>${safeBody}</p>`,
    fromName: config.from_name?.replace(/[<>"\r\n]/g, "").trim() || undefined,
  });
}

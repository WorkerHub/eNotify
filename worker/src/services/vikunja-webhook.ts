import { generateRandomToken } from "../core/apiKey";
import type { NotifyMessage } from "./notify/index";

/**
 * Vikunja inbound webhook adaptation (pure logic, unit tested on its own).
 *
 * Vikunja delivers `POST {event_name, time, data}` with an
 * `X-Vikunja-Signature` header: the lowercase hex HMAC-SHA256 of the raw
 * request body, keyed with the webhook secret the user configured in Vikunja.
 * The route only reads the raw body once and verifies that exact string, so
 * re-serialising the JSON can never break the signature.
 */

export const VIKUNJA_HOOK_TOKEN_PREFIX = "vhk_";
export const VIKUNJA_SIGNATURE_HEADER = "X-Vikunja-Signature";

/** User webhooks events eNotify adapts; everything else is ignored (200). */
export const VIKUNJA_EVENT_NAMES = [
  "task.reminder.fired",
  "task.overdue",
  "tasks.overdue",
] as const;

export type VikunjaEventName = (typeof VIKUNJA_EVENT_NAMES)[number];

/** `tasks.overdue` renders one line per task, at most 10 lines in total. */
export const VIKUNJA_SUMMARY_MAX_LINES = 10;

export function isVikunjaEventName(value: string): value is VikunjaEventName {
  return (VIKUNJA_EVENT_NAMES as readonly string[]).includes(value);
}

/** Hook token: high-entropy locator, safe to display and paste into Vikunja. */
export function generateVikunjaHookToken(): string {
  return generateRandomToken(VIKUNJA_HOOK_TOKEN_PREFIX);
}

/** Webhook secret: raw HMAC key material, shown to the user only once. */
export function generateVikunjaSecret(): string {
  return generateRandomToken();
}

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[index] = byte;
  }
  return bytes;
}

/**
 * Constant-time HMAC-SHA256 check of `X-Vikunja-Signature` against the raw
 * request body. Uses WebCrypto's `verify` (never `===` on signature strings),
 * and rejects anything that is not exactly 64 hex characters (32 bytes).
 */
export async function verifyVikunjaSignature(
  secret: string,
  signatureHeader: string | null | undefined,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;

  const provided = signatureHeader.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(provided)) return false;
  const signature = hexToBytes(provided);
  if (signature === null || signature.length !== 32) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(rawBody));
}

/**
 * Normalise a user-supplied Vikunja base URL: `http(s)` only, no trailing
 * slash, `""` means "no link". Returns null when the value is unusable.
 */
export function normalizeVikunjaBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Vikunja uses numbers for ids; accept a non-empty numeric string too. */
function idString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

function parseDueDate(dueDate: unknown): Date | null {
  if (typeof dueDate !== "string") return null;
  const raw = dueDate.trim();
  // Go's zero time is what Vikunja sends for "no due date".
  if (raw === "" || raw.startsWith("0001-01-01")) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() <= 1) return null;
  return date;
}

/**
 * `due_date` in the receiving user's timezone as `YYYY-MM-DD HH:mm`; null for
 * the zero value / invalid input so the 截止 line is simply omitted.
 */
export function formatVikunjaDue(
  dueDate: unknown,
  timeZone: string,
): string | null {
  const date = parseDueDate(dueDate);
  if (date === null) return null;

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const zone =
    typeof timeZone === "string" && timeZone.trim() !== ""
      ? timeZone.trim()
      : "UTC";

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: zone,
    }).formatToParts(date);
  } catch {
    // A stored timezone can only be invalid if it predates validation; never
    // fail a delivery over it, fall back to UTC.
    parts = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: "UTC",
    }).formatToParts(date);
  }

  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  if (!year || !month || !day || !hour || !minute) return null;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function projectTitle(
  projects: Record<string, unknown>,
  projectId: unknown,
): string {
  const key = idString(projectId);
  if (key === null) return "";
  return trimmedString(asRecord(projects[key])?.title);
}

function buildSingleTaskMessage(
  eventName: "task.reminder.fired" | "task.overdue",
  data: Record<string, unknown>,
  baseUrl: string,
  timeZone: string,
): NotifyMessage | null {
  const task = asRecord(data.task);
  if (task === null) return null;
  const taskId = idString(task.id);
  const title = trimmedString(task.title);
  if (taskId === null || title === "") return null;

  const bodyLines = [`项目：${trimmedString(asRecord(data.project)?.title)}`];
  const due = formatVikunjaDue(task.due_date, timeZone);
  if (due !== null) bodyLines.push(`截止：${due}`);

  return {
    title:
      eventName === "task.reminder.fired"
        ? `⏰ ${title}`
        : `⚠️ 已逾期：${title}`,
    body: bodyLines.join("\n"),
    url: baseUrl === "" ? undefined : `${baseUrl}/tasks/${taskId}`,
  };
}

function buildOverdueSummary(
  data: Record<string, unknown>,
  baseUrl: string,
): NotifyMessage | null {
  const rawTasks = data.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return null;

  const projects = asRecord(data.projects) ?? {};
  const total = rawTasks.length;
  const truncated = total > VIKUNJA_SUMMARY_MAX_LINES;
  const visible = truncated
    ? VIKUNJA_SUMMARY_MAX_LINES - 1
    : VIKUNJA_SUMMARY_MAX_LINES;

  const lines: string[] = [];
  for (const rawTask of rawTasks.slice(0, visible)) {
    const task = asRecord(rawTask);
    const title = trimmedString(task?.title);
    if (title === "") continue;
    const project = projectTitle(projects, task?.project_id);
    lines.push(project === "" ? `· ${title}` : `· ${title}（${project}）`);
  }
  // A summary whose task entries are all malformed has nothing to show.
  if (lines.length === 0 && !truncated) return null;
  if (truncated) lines.push(`… 等共 ${total} 个`);

  return {
    title: `⚠️ ${total} 个任务已逾期`,
    body: lines.join("\n"),
    url: baseUrl === "" ? undefined : baseUrl,
  };
}

/**
 * Translate a Vikunja User webhook event into the eNotify message shape.
 * Returns null for unknown events and for known events whose payload is too
 * incomplete to describe (the route answers 200 `{ignored: true}` then).
 */
export function buildVikunjaMessage(
  eventName: string,
  data: unknown,
  baseUrl: string | null | undefined,
  timeZone: string,
): NotifyMessage | null {
  if (!isVikunjaEventName(eventName)) return null;
  const payload = asRecord(data);
  if (payload === null) return null;

  const normalizedBaseUrl = normalizeVikunjaBaseUrl(baseUrl) ?? "";

  if (eventName === "tasks.overdue") {
    return buildOverdueSummary(payload, normalizedBaseUrl);
  }
  return buildSingleTaskMessage(
    eventName,
    payload,
    normalizedBaseUrl,
    timeZone,
  );
}

/**
 * Export / import ("backup") endpoints.
 *
 *   me    POST /api/me/export
 *         POST /api/me/import/preview
 *         POST /api/me/import
 *   admin POST /api/admin/export
 *         POST /api/admin/import/preview
 *         POST /api/admin/import
 *
 * Authentication is cookie session only. An API key (Authorization: Bearer
 * enk_...) is explicitly rejected: an export file is a master key bundle, so
 * these endpoints intentionally do not accept long-lived programmatic
 * credentials. Admin routes additionally require the admin role.
 *
 * Uploads are JSON request bodies (the web client already posts JSON through
 * `web/src/lib/api.ts`); the file itself may be sent either as a parsed object
 * (`{ file: {...} }`) or as the raw file text (`{ file: "<json text>" }`), and
 * the whole request body is capped at 10 MB.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { API_KEY_PREFIX } from "../core/apiKey";
import { findUserById } from "../db/queries/users";
import { authMiddleware, getEffectiveUserId } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import { rateLimit } from "../middleware/ratelimit";
import { getTablePrefix, type HonoEnv } from "../types";
import { BackupError } from "../lib/backup/errors";
import { buildExportFile } from "../lib/backup/export";
import {
  decryptExport,
  encryptExport,
  isEncryptedEnvelope,
} from "../lib/backup/crypto";
import { assertPlainExport, type PlainExportFile } from "../lib/backup/format";
import {
  executeImport,
  previewImport,
  type ImportMode,
  type ImportResult,
} from "../lib/backup/import";

/** Hard cap for an uploaded import body (parent spec suggests 10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type BackupContext = Context<HonoEnv>;

// ─── helpers ──────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tooLarge(): BackupError {
  return new BackupError(
    "PAYLOAD_TOO_LARGE",
    413,
    `上传内容超过上限 ${MAX_UPLOAD_BYTES} 字节（10MB）`,
    { max_bytes: MAX_UPLOAD_BYTES },
  );
}

/** Reads the request body once, enforcing the size cap before parsing. */
async function readJsonBody(
  c: BackupContext,
): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES)
    throw tooLarge();

  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > MAX_UPLOAD_BYTES)
    throw tooLarge();
  if (!text.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("INVALID_REQUEST", 400, "请求体必须是 JSON");
  }
  if (!isPlainObject(parsed)) {
    throw new BackupError("INVALID_REQUEST", 400, "请求体必须是 JSON 对象");
  }
  return parsed;
}

interface ImportPayload {
  /** Parsed export object or the raw file text. */
  file: unknown;
  passphrase: string;
}

function readImportPayload(body: Record<string, unknown>): ImportPayload {
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";

  let file = body.file;
  if (typeof file === "string") {
    if (new TextEncoder().encode(file).length > MAX_UPLOAD_BYTES)
      throw tooLarge();
    try {
      file = JSON.parse(file);
    } catch {
      throw new BackupError("INVALID_FILE", 400, "上传的文件不是有效的 JSON");
    }
  }
  if (file === undefined || file === null) {
    throw new BackupError(
      "INVALID_REQUEST",
      400,
      "缺少 file 字段（导入文件内容）",
    );
  }
  return { file, passphrase };
}

/** Decrypts if needed and validates the frozen v1 format contract. */
async function resolveImportFile(
  payload: ImportPayload,
): Promise<{ plain: PlainExportFile; encrypted: boolean }> {
  const encrypted = isEncryptedEnvelope(payload.file);
  const decoded = encrypted
    ? await decryptExport(payload.file, payload.passphrase)
    : payload.file;
  return { plain: assertPlainExport(decoded), encrypted };
}

/**
 * Audit sink: exports and imports each emit one structured `[audit]` line with
 * the operator, scope/mode, whether the file was encrypted and the per-table
 * row counts. Passphrases never reach this function.
 * (The current schema has no audit table; this follows the existing `[audit]`
 * console convention used for admin impersonation.)
 */
function writeAudit(event: Record<string, unknown>): void {
  console.log(`[audit] backup ${JSON.stringify(event)}`);
}

async function loadActor(
  db: D1Database,
  prefix: string,
  userId: string,
): Promise<{ id: string; email: string }> {
  const user = await findUserById(db, prefix, userId);
  if (!user) throw new BackupError("INVALID_REQUEST", 401, "Unauthorized");
  return { id: user.id, email: user.email };
}

/**
 * Merge needs the operator's real account row (its id and email drive the
 * rewrite). Restore runs against an instance whose `users` table is empty by
 * definition, so the operator is identified by the signed session alone —
 * looking their row up would always fail on a fresh instance.
 */
async function resolveActor(
  c: BackupContext,
  mode: ImportMode,
): Promise<{ id: string; email: string }> {
  const userId = getEffectiveUserId(c);
  if (mode === "merge") {
    return loadActor(c.env.DB, getTablePrefix(c.env), userId);
  }
  return { id: userId, email: "" };
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

/**
 * These endpoints never accept API-key auth: a backup file is a master key
 * bundle, so it must be produced/consumed with an interactive session.
 */
async function rejectApiKeyAuth(
  c: BackupContext,
  next: Next,
): Promise<Response | undefined> {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer?.startsWith(API_KEY_PREFIX)) {
    return c.json(
      {
        error: "导出/导入接口不接受 API Key，请使用浏览器会话登录后再操作",
        code: "API_KEY_NOT_ALLOWED",
      },
      403,
    );
  }
  await next();
  return undefined;
}

function errorResponse(c: BackupContext, err: unknown): Response {
  if (err instanceof BackupError) {
    return c.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
      err.status as ContentfulStatusCode,
    );
  }
  console.error("Backup endpoint failed:", err);
  return c.json({ error: "Internal server error" }, 500);
}

function jsonHandler(handler: (c: BackupContext) => Promise<Response>) {
  return async (c: BackupContext): Promise<Response> => {
    try {
      return await handler(c);
    } catch (err) {
      return errorResponse(c, err);
    }
  };
}

// ─── shared handlers ──────────────────────────────────────────────────────────

async function exportHandler(
  c: BackupContext,
  scope: "instance" | "user",
): Promise<Response> {
  const body = await readJsonBody(c);
  const encrypted = body.encrypted !== false; // encrypted by default
  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  const includeHistory = body.include_history === true;

  if (encrypted && !passphrase) {
    throw new BackupError(
      "PASSPHRASE_REQUIRED",
      400,
      "加密导出必须提供口令；若要导出明文文件，请显式传 encrypted: false",
    );
  }

  const prefix = getTablePrefix(c.env);
  const userId = getEffectiveUserId(c);
  const { file, counts } = await buildExportFile(c.env.DB, prefix, {
    scope,
    userId: scope === "user" ? userId : undefined,
    includeHistory,
  });
  const payload = encrypted ? await encryptExport(file, passphrase) : file;

  writeAudit({
    action: "export",
    scope,
    operator: c.get("userId"),
    impersonating: c.get("impersonating") ?? null,
    encrypted,
    include_history: includeHistory,
    rows: counts,
    at: new Date().toISOString(),
  });

  const filename = `enotify-${scope}-${timestampForFilename()}-${
    encrypted ? "encrypted" : "plain"
  }.json`;

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

async function previewHandler(
  c: BackupContext,
  resolveMode: (body: Record<string, unknown>) => ImportMode,
): Promise<Response> {
  const body = await readJsonBody(c);
  const mode = resolveMode(body);
  const payload = readImportPayload(body);
  const { plain, encrypted } = await resolveImportFile(payload);

  const prefix = getTablePrefix(c.env);
  const actor = await resolveActor(c, mode);
  const preview = await previewImport(c.env.DB, prefix, plain, {
    mode,
    actor,
    encrypted,
  });
  return c.json({ ok: true, ...preview });
}

async function importHandler(
  c: BackupContext,
  fixedMode: ImportMode | undefined,
): Promise<Response> {
  const body = await readJsonBody(c);
  const requestedMode = body.mode;

  let mode: ImportMode;
  if (fixedMode) {
    if (requestedMode !== undefined && requestedMode !== fixedMode) {
      throw new BackupError(
        "MODE_NOT_ALLOWED",
        400,
        `个人档导入只支持 mode: "${fixedMode}"`,
      );
    }
    mode = fixedMode;
  } else if (requestedMode === undefined) {
    mode = "restore";
  } else if (requestedMode === "restore" || requestedMode === "merge") {
    mode = requestedMode;
  } else {
    throw new BackupError(
      "INVALID_REQUEST",
      400,
      'mode 必须是 "restore" 或 "merge"',
    );
  }

  const payload = readImportPayload(body);
  const { plain, encrypted } = await resolveImportFile(payload);

  const prefix = getTablePrefix(c.env);
  const actor = await resolveActor(c, mode);

  const result: ImportResult = await executeImport(c.env.DB, prefix, plain, {
    mode,
    actor,
    encrypted,
  });

  writeAudit({
    action: "import",
    mode,
    scope: plain.scope,
    operator: actor.id,
    encrypted,
    written: result.written,
    at: new Date().toISOString(),
  });

  return c.json(result);
}

// ─── routers ──────────────────────────────────────────────────────────────────

/**
 * Cheap abuse guard for the two expensive operations (PBKDF2 on the exported
 * file, and bulk writes on import). Keyed by user, per endpoint group.
 */
const backupLimiter = rateLimit({
  max: 20,
  window: 60,
  keyPrefix: "backup",
  keyFn: (c) => c.get("userId") ?? "",
});

export const meBackupRoutes = new Hono<HonoEnv>();
meBackupRoutes.use("*", rejectApiKeyAuth);
meBackupRoutes.use("*", authMiddleware);
meBackupRoutes.use("*", backupLimiter);

meBackupRoutes.post(
  "/export",
  jsonHandler((c) => exportHandler(c, "user")),
);

meBackupRoutes.post(
  "/import/preview",
  jsonHandler((c) => previewHandler(c, () => "merge")),
);

meBackupRoutes.post(
  "/import",
  jsonHandler((c) => importHandler(c, "merge")),
);

export const adminBackupRoutes = new Hono<HonoEnv>();
adminBackupRoutes.use("*", rejectApiKeyAuth);
adminBackupRoutes.use("*", authMiddleware);
adminBackupRoutes.use("*", adminMiddleware);
adminBackupRoutes.use("*", backupLimiter);

adminBackupRoutes.post(
  "/export",
  jsonHandler((c) => exportHandler(c, "instance")),
);

adminBackupRoutes.post(
  "/import/preview",
  jsonHandler((c) => previewHandler(c, adminPreviewMode)),
);

adminBackupRoutes.post(
  "/import",
  jsonHandler((c) => importHandler(c, undefined)),
);

/**
 * Admin preview defaults to restore mode; an explicit `mode: "merge"` selects
 * merge (into the signed-in admin account) instead.
 */
function adminPreviewMode(body: Record<string, unknown>): ImportMode {
  const mode = body.mode;
  if (mode === undefined) return "restore";
  if (mode === "restore" || mode === "merge") return mode;
  throw new BackupError(
    "INVALID_REQUEST",
    400,
    'mode 必须是 "restore" 或 "merge"',
  );
}

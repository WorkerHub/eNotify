import { api } from "@/lib/api";

/**
 * Export / import ("backup") HTTP surface.
 *
 * Contract: `worker/src/lib/backup/CONTRACT.md` (backend ONE-359). Session
 * cookie auth only — these endpoints reject API keys by design, so callers
 * must never route them through the API-key path.
 */

/** The seven tables carried by an export file, in server order. */
export const BACKUP_TABLES = [
  "users",
  "user_2fa",
  "items",
  "payment_history",
  "notification_configs",
  "system_settings",
  "notification_history",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export type BackupScope = "user" | "instance";

export type ImportMode = "restore" | "merge";

export type BackupCounts = Record<BackupTable, number>;

/** Server-side request body cap (10 MB), see CONTRACT.md §2. */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export interface BackupExportOptions {
  encrypted: boolean;
  passphrase?: string;
  includeHistory: boolean;
}

export interface BackupDownload {
  blob: Blob;
  filename: string;
}

export interface BackupPreview {
  ok: boolean;
  mode: ImportMode;
  scope: BackupScope;
  encrypted: boolean;
  format_version: number;
  app_version: string;
  exported_at: string;
  counts: BackupCounts;
  will_write: BackupCounts;
  users: { id: string; email: string; role: string }[];
  can_execute: boolean;
  blockers: { code: string; message: string }[];
  conflicts: {
    target_users: number;
    email_conflicts: string[];
    settings_overwritten: string[];
    config_overwritten: boolean;
    skipped_orphan_payments: number;
    skipped_foreign_items: number;
    skipped_foreign_payments: number;
    skipped_history_rows: number;
  };
  ignored_tables: string[];
  warnings: string[];
}

export interface BackupImportResult {
  ok: boolean;
  mode: ImportMode;
  scope: BackupScope;
  written: BackupCounts;
  total_written: number;
  notices: string[];
  warnings: string[];
}

export interface BackupImportRequest {
  /** Raw file text: the API accepts the export file as a JSON string. */
  fileText: string;
  passphrase?: string;
  mode?: ImportMode;
}

function scopeBase(scope: BackupScope): string {
  return scope === "user" ? "/me" : "/admin";
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

function fallbackFilename(scope: BackupScope, encrypted: boolean): string {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "");
  return `enotify-${scope}-${stamp}-${encrypted ? "encrypted" : "plain"}.json`;
}

/** Exports and returns the file as a blob plus the server-chosen filename. */
export async function exportBackup(
  scope: BackupScope,
  options: BackupExportOptions,
): Promise<BackupDownload> {
  const response = await api.postRaw(`${scopeBase(scope)}/export`, {
    encrypted: options.encrypted,
    ...(options.passphrase ? { passphrase: options.passphrase } : {}),
    include_history: options.includeHistory,
  });

  return {
    blob: await response.blob(),
    filename:
      filenameFromDisposition(response.headers.get("Content-Disposition")) ??
      fallbackFilename(scope, options.encrypted),
  };
}

function importBody({ fileText, passphrase, mode }: BackupImportRequest) {
  return {
    file: fileText,
    ...(passphrase ? { passphrase } : {}),
    ...(mode ? { mode } : {}),
  };
}

/** Dry run: parses the file and reports what an import would do. Writes nothing. */
export async function previewBackupImport(
  scope: BackupScope,
  request: BackupImportRequest,
): Promise<BackupPreview> {
  return api.post<BackupPreview>(
    `${scopeBase(scope)}/import/preview`,
    importBody(request),
  );
}

/** Executes the import (one server-side transaction). */
export async function executeBackupImport(
  scope: BackupScope,
  request: BackupImportRequest,
): Promise<BackupImportResult> {
  return api.post<BackupImportResult>(
    `${scopeBase(scope)}/import`,
    importBody(request),
  );
}

/** Hands a blob to the browser's download machinery. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

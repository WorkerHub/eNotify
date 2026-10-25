import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api";

/**
 * Machine code → i18n key for the backup endpoints (CONTRACT.md §6). The
 * server messages are Chinese-only, so known codes are localized on the
 * client; unknown codes fall back to the server message.
 */
const ERROR_KEYS: Record<string, string> = {
  PASSPHRASE_REQUIRED: "backup.errors.passphraseRequired",
  DECRYPT_FAILED: "backup.errors.decryptFailed",
  INVALID_ENVELOPE: "backup.errors.invalidFile",
  INVALID_FORMAT: "backup.errors.invalidFile",
  INVALID_FILE: "backup.errors.invalidFile",
  INVALID_ROW: "backup.errors.invalidFile",
  UNSUPPORTED_FORMAT_VERSION: "backup.errors.unsupportedVersion",
  MODE_NOT_ALLOWED: "backup.errors.modeNotAllowed",
  MERGE_SOURCE_NOT_FOUND: "backup.errors.mergeSourceNotFound",
  RESTORE_TARGET_NOT_EMPTY: "backup.errors.restoreTargetNotEmpty",
  PAYLOAD_TOO_LARGE: "backup.errors.payloadTooLarge",
  STALE_PREVIEW: "backup.errors.stalePreview",
  WRITE_FAILED: "backup.errors.writeFailed",
  RESTORE_COUNT_MISMATCH: "backup.errors.writeFailed",
  API_KEY_NOT_ALLOWED: "backup.errors.sessionOnly",
};

export function describeBackupError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    const key = err.code ? ERROR_KEYS[err.code] : undefined;
    if (key) return t(key);
    if (err.status === 413) return t("backup.errors.payloadTooLarge");
    if (err.status === 403) return t("backup.errors.forbidden");
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return t("common.error");
}

/** Localized text for a preflight blocker code, falling back to server text. */
export function describeBlocker(
  blocker: { code: string; message: string },
  t: TFunction,
): string {
  return t(`backup.blockerCodes.${blocker.code}`, {
    defaultValue: blocker.message,
  });
}

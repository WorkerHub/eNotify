/**
 * Error type for the export/import ("backup") feature.
 *
 * Every user-facing failure is expressed as a BackupError carrying a stable
 * machine-readable `code` and the HTTP status the route should answer with, so
 * the frontend can branch on `code` instead of on message text. Messages are
 * deliberately free of secrets: passphrases never appear in errors or logs.
 */
export type BackupErrorCode =
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_FILE"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_FORMAT_VERSION"
  | "INVALID_SCOPE"
  | "INVALID_ROW"
  | "PASSPHRASE_REQUIRED"
  | "PASSPHRASE_NOT_APPLICABLE"
  | "INVALID_ENVELOPE"
  | "DECRYPT_FAILED"
  | "MODE_NOT_ALLOWED"
  | "RESTORE_TARGET_NOT_EMPTY"
  | "MERGE_SOURCE_NOT_FOUND"
  | "MISSING_COLUMN"
  | "DUPLICATE_KEY"
  | "REFERENCE_MISSING"
  | "STALE_PREVIEW"
  | "RESTORE_COUNT_MISMATCH"
  | "TABLE_MISSING"
  | "WRITE_FAILED";

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: BackupErrorCode,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

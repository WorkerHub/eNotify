import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Info,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_BACKUP_BYTES,
  type BackupImportResult,
  type BackupPreview,
  type BackupScope,
  executeBackupImport,
  previewBackupImport,
  type ImportMode,
} from "@/lib/backup";
import { cn } from "@/lib/utils";
import { BackupCountsTable } from "./BackupCountsTable";
import { describeBackupError, describeBlocker } from "./describeBackupError";

type PickedFile = { name: string; size: number; text: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Import half of the backup 闭环: pick file → preflight → confirm → result. */
export function BackupImportPanel({ scope }: { scope: BackupScope }) {
  const { t } = useTranslation();

  const isInstance = scope === "instance";

  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [passphrase, setPassphrase] = useState("");
  const [mode, setMode] = useState<ImportMode>("restore");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const tableLabel = (name: string) =>
    t(`backup.tables.${name}`, { defaultValue: name });

  const reset = () => {
    setFile(null);
    setFileInputKey((k) => k + 1);
    setPassphrase("");
    setPreview(null);
    setResult(null);
    setError("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    setPreview(null);
    setResult(null);
    setError("");
    if (!picked) {
      setFile(null);
      return;
    }
    if (picked.size > MAX_BACKUP_BYTES) {
      setFile(null);
      e.target.value = "";
      setError(t("backup.errors.payloadTooLarge"));
      return;
    }
    try {
      setFile({
        name: picked.name,
        size: picked.size,
        text: await picked.text(),
      });
    } catch {
      setFile(null);
      e.target.value = "";
      setError(t("backup.errors.fileReadFailed"));
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError(t("backup.fileRequired"));
      return;
    }
    setBusy("preview");
    setError("");
    setResult(null);
    try {
      const data = await previewBackupImport(scope, {
        fileText: file.text,
        passphrase: passphrase || undefined,
        mode: isInstance ? mode : undefined,
      });
      setPreview(data);
      if (data.mode) setMode(data.mode);
    } catch (err) {
      setPreview(null);
      setError(describeBackupError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const handleExecute = async () => {
    if (!file || !preview) return;
    setConfirmOpen(false);
    setBusy("import");
    setError("");
    try {
      const data = await executeBackupImport(scope, {
        fileText: file.text,
        passphrase: passphrase || undefined,
        mode: isInstance ? mode : undefined,
      });
      setResult(data);
      // Clear the picked file + passphrase so a second click cannot re-import.
      setFile(null);
      setPassphrase("");
      setPreview(null);
      setFileInputKey((k) => k + 1);
    } catch (err) {
      setError(describeBackupError(err, t));
    } finally {
      setBusy(null);
    }
  };

  const confirmIsRestore = preview?.mode === "restore";

  const conflictRows: { label: string; tone: "danger" | "warning" }[] = [];
  if (preview) {
    const c = preview.conflicts;
    if (c.target_users > 0) {
      conflictRows.push({
        label: t("backup.conflictTargetUsers", { count: c.target_users }),
        tone: "danger",
      });
    }
    if (c.email_conflicts?.length) {
      conflictRows.push({
        label: t("backup.conflictEmailConflicts", {
          emails: c.email_conflicts.join(", "),
        }),
        tone: "danger",
      });
    }
    if (c.config_overwritten) {
      conflictRows.push({
        label: t("backup.conflictConfigOverwritten"),
        tone: "warning",
      });
    }
    if (c.settings_overwritten?.length) {
      conflictRows.push({
        label: t("backup.conflictSettingsOverwritten", {
          keys: c.settings_overwritten.join(", "),
        }),
        tone: "warning",
      });
    }
    if (c.skipped_orphan_payments > 0) {
      conflictRows.push({
        label: t("backup.conflictSkippedOrphan", {
          count: c.skipped_orphan_payments,
        }),
        tone: "warning",
      });
    }
    if (c.skipped_foreign_items > 0) {
      conflictRows.push({
        label: t("backup.conflictSkippedForeignItems", {
          count: c.skipped_foreign_items,
        }),
        tone: "warning",
      });
    }
    if (c.skipped_foreign_payments > 0) {
      conflictRows.push({
        label: t("backup.conflictSkippedForeignPayments", {
          count: c.skipped_foreign_payments,
        }),
        tone: "warning",
      });
    }
    if (c.skipped_history_rows > 0) {
      conflictRows.push({
        label: t("backup.conflictSkippedHistory", {
          count: c.skipped_history_rows,
        }),
        tone: "warning",
      });
    }
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-5">
      <ConfirmDialog
        open={confirmOpen}
        title={t(
          confirmIsRestore
            ? "backup.confirmRestoreTitle"
            : "backup.confirmMergeTitle",
        )}
        message={t(
          confirmIsRestore
            ? "backup.confirmRestoreMessage"
            : "backup.confirmMergeMessage",
        )}
        variant={confirmIsRestore ? "danger" : "primary"}
        confirmLabel={t("backup.confirmImport")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void handleExecute()}
        onCancel={() => setConfirmOpen(false)}
      />

      <div>
        <h3 className="text-title">{t("backup.importTitle")}</h3>
        <p className="text-caption text-muted-foreground mt-0.5">
          {t("backup.importDescription")}
        </p>
      </div>

      {result ? (
        /* ---------------- Result ---------------- */
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3">
            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <div>
              <p className="text-body-sm font-medium text-foreground">
                {t("backup.resultTitle")}
              </p>
              <p className="text-caption text-muted-foreground mt-0.5">
                {t("backup.resultTotal", { count: result.total_written })} ·{" "}
                {t(
                  result.mode === "restore"
                    ? "backup.modeRestoreShort"
                    : "backup.modeMergeShort",
                )}
              </p>
            </div>
          </div>

          <BackupCountsTable
            counts={result.written}
            countLabel={t("backup.writtenLabel")}
          />

          {result.notices.length > 0 && (
            <ul className="space-y-1.5 rounded-md border border-warning/30 bg-warning/5 p-3">
              {result.notices.map((notice) => (
                <li
                  key={notice}
                  className="flex items-start gap-2 text-body-sm text-foreground"
                >
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <span>{notice}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-caption text-muted-foreground">
              <p>{t("backup.reloginNotice")}</p>
              {result.mode === "restore" && <p>{t("backup.apiKeyNotice")}</p>}
            </div>
          </div>

          {result.warnings?.length > 0 && (
            <div className="space-y-1">
              <p className="text-caption font-medium text-foreground">
                {t("backup.warningsTitle")}
              </p>
              <ul className="space-y-1 text-caption text-muted-foreground">
                {result.warnings.map((warning) => (
                  <li key={warning}>· {warning}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="py-2 px-4 bg-muted hover:bg-muted/80 text-foreground text-body-sm font-medium rounded-md transition-colors duration-(--duration-fast) ease-(--ease-standard)"
          >
            {t("backup.importAnother")}
          </button>
        </div>
      ) : (
        /* ---------------- Pick + preflight ---------------- */
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="backup-import-file">{t("backup.selectFile")}</Label>
            <Input
              key={fileInputKey}
              id="backup-import-file"
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
            />
            <p className="text-caption text-muted-foreground">
              {file
                ? t("backup.selectedFile", {
                    name: file.name,
                    size: formatBytes(file.size),
                  })
                : t("backup.fileHint", { max: formatBytes(MAX_BACKUP_BYTES) })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="backup-import-passphrase">
              {t("backup.filePassphrase")}
            </Label>
            <Input
              id="backup-import-passphrase"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                setPreview(null);
              }}
              placeholder={t("backup.filePassphrasePlaceholder")}
            />
            <p className="text-caption text-muted-foreground">
              {t("backup.filePassphraseHint")}
            </p>
          </div>

          {isInstance ? (
            <div className="space-y-1.5">
              <Label htmlFor="backup-import-mode">
                {t("backup.targetMode")}
              </Label>
              <select
                id="backup-import-mode"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as ImportMode);
                  setPreview(null);
                }}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-body-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="restore">{t("backup.modeRestore")}</option>
                <option value="merge">{t("backup.modeMerge")}</option>
              </select>
              <p className="text-caption text-muted-foreground">
                {t(
                  mode === "restore"
                    ? "backup.modeRestoreHint"
                    : "backup.modeMergeHint",
                )}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-caption text-muted-foreground">
                {t("backup.modeFixedMerge")}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
            <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-caption text-muted-foreground">
              <p>{t("backup.reloginNotice")}</p>
              <p>{t("backup.apiKeyNotice")}</p>
            </div>
          </div>

          {error && !preview && (
            <p className="text-body-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {error}
            </p>
          )}

          {!preview && (
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={busy !== null || !file}
              className="inline-flex items-center gap-2 py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-body-sm font-medium rounded-md transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <FileJson className="w-4 h-4" />
              {busy === "preview"
                ? t("backup.previewing")
                : t("backup.previewAction")}
            </button>
          )}

          {preview && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-title">{t("backup.previewTitle")}</p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium",
                    preview.can_execute
                      ? "text-success bg-success/10"
                      : "text-destructive bg-destructive/10",
                  )}
                >
                  {preview.can_execute
                    ? t("backup.canExecute")
                    : t("backup.cannotExecute")}
                </span>
              </div>

              <p className="text-caption text-muted-foreground">
                {t("backup.previewSummary", {
                  version: preview.format_version,
                  scope: t(
                    preview.scope === "instance"
                      ? "backup.scopeInstance"
                      : "backup.scopeUser",
                  ),
                  mode: t(
                    preview.mode === "restore"
                      ? "backup.modeRestoreShort"
                      : "backup.modeMergeShort",
                  ),
                  encryption: t(
                    preview.encrypted
                      ? "backup.encryptedYes"
                      : "backup.encryptedNo",
                  ),
                  date: new Date(preview.exported_at).toLocaleString(),
                })}
              </p>

              <BackupCountsTable
                counts={preview.counts}
                secondary={preview.will_write}
              />

              <div className="space-y-1">
                <p className="text-caption font-medium text-foreground">
                  {t("backup.usersTitle")}
                </p>
                {preview.users.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {t("backup.usersEmpty")}
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {preview.users.map((user) => (
                      <li
                        key={user.id}
                        className="rounded-full bg-background border px-2 py-0.5 text-caption"
                      >
                        {user.email}
                        <span className="ml-1.5 text-muted-foreground">
                          {user.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-caption font-medium text-foreground">
                  {t("backup.conflictsTitle")}
                </p>
                {conflictRows.length === 0 ? (
                  <p className="text-caption text-muted-foreground">
                    {t("backup.noConflicts")}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {conflictRows.map((row) => (
                      <li
                        key={row.label}
                        className={cn(
                          "flex items-start gap-2 text-caption",
                          row.tone === "danger"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{row.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {preview.ignored_tables.length > 0 && (
                <div className="space-y-1">
                  <p className="text-caption font-medium text-foreground">
                    {t("backup.ignoredTablesTitle")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {preview.ignored_tables.map((table) => (
                      <li
                        key={table}
                        className="rounded-full bg-background border px-2 py-0.5 text-caption text-muted-foreground"
                      >
                        {tableLabel(table)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.blockers.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <p className="text-caption font-medium text-destructive">
                    {t("backup.blockersTitle")}
                  </p>
                  <ul className="space-y-1">
                    {preview.blockers.map((blocker) => (
                      <li
                        key={`${blocker.code}-${blocker.message}`}
                        className="text-caption text-destructive"
                      >
                        · {describeBlocker(blocker, t)}
                        <span className="ml-1 font-mono text-muted-foreground">
                          {blocker.code}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-caption font-medium text-foreground">
                    {t("backup.warningsTitle")}
                  </p>
                  <ul className="space-y-1 text-caption text-muted-foreground">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>· {warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <p className="text-body-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!preview.can_execute || busy !== null}
                  className={cn(
                    "inline-flex items-center gap-2 py-2 px-4 text-body-sm font-medium rounded-md transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
                    preview.can_execute
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                      : "bg-muted text-muted-foreground cursor-not-allowed",
                  )}
                >
                  <Upload className="w-4 h-4" />
                  {busy === "import"
                    ? t("backup.importing")
                    : t("backup.confirmImport")}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePreview()}
                  disabled={busy !== null}
                  className="py-2 px-4 bg-muted hover:bg-muted/80 text-foreground text-body-sm font-medium rounded-md transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50"
                >
                  {t("backup.reexecutePreview")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { downloadBlob, exportBackup, type BackupScope } from "@/lib/backup";
import { describeBackupError } from "./describeBackupError";

const MIN_PASSPHRASE_LENGTH = 8;

/** Export half of the backup闭环: options → download. */
export function BackupExportPanel({ scope }: { scope: BackupScope }) {
  const { t } = useTranslation();

  const [encrypted, setEncrypted] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [includeHistory, setIncludeHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const resetPassphrase = () => {
    setPassphrase("");
    setPassphraseConfirm("");
  };

  const handleExport = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (encrypted) {
      if (!passphrase) {
        setError(t("backup.passphraseRequired"));
        return;
      }
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(
          t("backup.passphraseTooShort", { min: MIN_PASSPHRASE_LENGTH }),
        );
        return;
      }
      if (passphrase !== passphraseConfirm) {
        setError(t("backup.passphraseMismatch"));
        return;
      }
    }

    setBusy(true);
    try {
      const { blob, filename } = await exportBackup(scope, {
        encrypted,
        passphrase: encrypted ? passphrase : undefined,
        includeHistory,
      });
      downloadBlob(blob, filename);
      resetPassphrase();
      setSuccessMsg(
        t(
          encrypted
            ? "backup.exportSuccessEncrypted"
            : "backup.exportSuccessPlain",
          { filename },
        ),
      );
    } catch (err) {
      setError(describeBackupError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleExport}
      className="bg-card border rounded-lg p-5 space-y-5"
    >
      <div>
        <h3 className="text-title">{t("backup.exportTitle")}</h3>
        <p className="text-caption text-muted-foreground mt-0.5">
          {t("backup.exportDescription")}
        </p>
      </div>

      {/* Encrypt (default on — spec §敏感性） */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="backup-export-encrypted">{t("backup.encrypt")}</Label>
          <p className="text-caption text-muted-foreground mt-0.5">
            {t("backup.encryptDescription")}
          </p>
        </div>
        <Switch
          id="backup-export-encrypted"
          checked={encrypted}
          onCheckedChange={(v) => {
            setEncrypted(v);
            setError("");
            if (!v) resetPassphrase();
          }}
        />
      </div>

      {encrypted && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="backup-export-passphrase">
              {t("backup.passphrase")}
            </Label>
            <Input
              id="backup-export-passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("backup.passphrasePlaceholder", {
                min: MIN_PASSPHRASE_LENGTH,
              })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-export-passphrase-confirm">
              {t("backup.passphraseConfirm")}
            </Label>
            <Input
              id="backup-export-passphrase-confirm"
              type="password"
              autoComplete="new-password"
              value={passphraseConfirm}
              onChange={(e) => setPassphraseConfirm(e.target.value)}
            />
          </div>
          <p className="text-caption text-muted-foreground sm:col-span-2">
            {t("backup.passphraseHint")}
          </p>
        </div>
      )}

      {/* Include notification_history (default off) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="backup-export-history">
            {t("backup.includeHistory")}
          </Label>
          <p className="text-caption text-muted-foreground mt-0.5">
            {t("backup.includeHistoryDescription")}
          </p>
        </div>
        <Switch
          id="backup-export-history"
          checked={includeHistory}
          onCheckedChange={setIncludeHistory}
        />
      </div>

      {/* Two mandatory warnings, next to the export button (ONE-358 spec) */}
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-caption text-muted-foreground">
            {t("backup.masterKeyWarning")}
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
          <ShieldAlert className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-caption text-muted-foreground">
            {t("backup.apiKeyNotice")}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-body-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}
      {successMsg && (
        <p className="text-body-sm text-success bg-success/10 px-3 py-2 rounded-md">
          {successMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-body-sm font-medium rounded-md transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Download className="w-4 h-4" />
        {busy ? t("backup.exporting") : t("backup.exportAction")}
      </button>
    </form>
  );
}

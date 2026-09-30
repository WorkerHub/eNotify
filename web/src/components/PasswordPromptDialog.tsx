import { useState } from "react";
import { useTranslation } from "react-i18next";

interface PasswordPromptDialogProps {
  open: boolean;
  title: string;
  onSubmit: (password: string) => void | Promise<void>;
  onCancel: () => void;
}

export function PasswordPromptDialog({
  open,
  title,
  onSubmit,
  onCancel,
}: PasswordPromptDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");

  if (!open) return null;

  const close = () => {
    setPassword("");
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={close}
      />
      <form
        className="relative bg-card border rounded-xl p-6 w-full max-w-sm mx-4 space-y-4 shadow-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = password;
          setPassword("");
          await onSubmit(value);
        }}
      >
        <div className="space-y-1">
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.confirmPasswordHint")}
          </p>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          // biome-ignore lint/a11y/noAutofocus: dialog opens on explicit user action
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-accent transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={!password}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          >
            {t("common.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}

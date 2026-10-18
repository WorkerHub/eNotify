import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ArrowLeft, AlertCircle, Database } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SystemSettings } from "@/types";

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5",
          checked ? "bg-primary" : "bg-gray-300 dark:bg-gray-600",
        )}
      >
        <span
          className={cn(
            "absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

export function AdminSystemPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [setupPageEnabled, setSetupPageEnabled] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [upgrading, setUpgrading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState("");
  const [upgradeError, setUpgradeError] = useState("");

  useEffect(() => {
    api
      .get<SystemSettings>("/admin/system/settings")
      .then((s) => setSetupPageEnabled((s.setup_page_enabled ?? "1") !== "0"))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaveMsg("");
    try {
      await api.put("/admin/system/settings", {
        setup_page_enabled: setupPageEnabled ? "1" : "0",
      });
      setSaveMsg(t("common.success"));
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    setUpgradeError("");
    setUpgradeResult("");
    try {
      const res = await api.post<{
        success: boolean;
        alreadyInitialized?: boolean;
      }>("/admin/setup");
      setUpgradeResult(
        res.alreadyInitialized
          ? t("admin.dbUpToDate")
          : t("admin.dbInitialized"),
      );
    } catch (e: any) {
      if (e instanceof ApiError) {
        setUpgradeError(
          e.status === 401
            ? t("admin.dbUpgradeUnauthorized")
            : e.status === 403
              ? t("admin.dbUpgradeForbidden")
              : t("admin.dbUpgradeFailed"),
        );
      } else {
        setUpgradeError(t("admin.dbUpgradeFailed"));
      }
    } finally {
      setUpgrading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse max-w-xl">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-40 bg-muted rounded-xl" />
        <div className="h-40 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/admin")}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold">{t("admin.system")}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-card rounded-xl border p-5 space-y-5">
          <h2 className="font-semibold">{t("admin.appSettings")}</h2>

          <Toggle
            checked={setupPageEnabled}
            onChange={setSetupPageEnabled}
            label={t("admin.setupPage")}
            description={t("admin.setupPageDesc")}
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
          {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
        </div>
      </form>

      <section className="bg-card rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold">{t("admin.dbMaintenance")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.dbMaintenanceDesc")}
        </p>

        {upgradeResult && (
          <p className="text-sm text-green-600">{upgradeResult}</p>
        )}
        {upgradeError && (
          <p className="text-sm text-destructive">{upgradeError}</p>
        )}

        <button
          type="button"
          disabled={upgrading}
          onClick={handleUpgrade}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
        >
          <Database className="w-4 h-4" />
          {upgrading ? t("admin.checkingDb") : t("admin.checkUpgradeDb")}
        </button>
      </section>
    </div>
  );
}

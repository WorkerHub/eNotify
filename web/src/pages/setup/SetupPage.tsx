import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Database, Globe } from "lucide-react";
import { setupApi, ApiError } from "@/lib/api";
import { AuthShell, FormError } from "@/components/AuthShell";

type View = "loading" | "disabled" | "form" | "done";

export function SetupPage() {
  const { t, i18n } = useTranslation();

  const [view, setView] = useState<View>("loading");
  const [secret, setSecret] = useState("");
  const [alreadyInitialized, setAlreadyInitialized] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setupApi
      .state()
      .then((s) => {
        if (!cancelled) setView(s.enabled === false ? "disabled" : "form");
      })
      .catch(() => {
        // A failed state request still lets the user try; treat setup as available.
        if (!cancelled) setView("form");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!secret.trim()) {
      setError(t("setup.missingSecret"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await setupApi.run(secret.trim());
      setAlreadyInitialized(!!res.alreadyInitialized);
      setView("done");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setError(t("setup.wrongSecret"));
        else if (err.status === 429) setError(t("setup.rateLimited"));
        else setError(t("setup.genericError"));
      } else {
        setError(t("setup.genericError"));
      }
    } finally {
      setSecret("");
      setSubmitting(false);
    }
  };

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  };

  return (
    <AuthShell
      title={
        <span className="inline-flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary">
            <Database className="h-5 w-5 text-primary-foreground" />
          </span>
          {t("app.name")}
        </span>
      }
      subtitle={view === "form" ? t("setup.desc") : undefined}
    >
      <div className="fixed top-4 right-4">
        <button
          type="button"
          onClick={toggleLang}
          className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Switch language"
        >
          <Globe className="w-4 h-4" />
        </button>
      </div>

      <div className="w-full">
        <div>
          {view === "loading" && (
            <p className="text-center text-body-sm text-muted-foreground">
              {t("auth.loading")}
            </p>
          )}

          {view === "disabled" && (
            <div className="space-y-4">
              <h1 className="text-title">{t("setup.title")}</h1>
              <p role="alert" className="text-body-sm text-muted-foreground">
                {t("setup.disabled")}
              </p>
              <Link
                to="/login"
                className="block w-full text-center py-2 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-body-sm font-medium rounded-md transition-colors"
              >
                {t("setup.goLogin")}
              </Link>
            </div>
          )}

          {view === "done" && (
            <div className="space-y-4">
              <h1 className="text-title">{t("setup.title")}</h1>
              <p className="text-body-sm text-success">
                {alreadyInitialized
                  ? t("setup.alreadyInitialized")
                  : t("setup.success")}
              </p>
              {!alreadyInitialized && (
                <p className="text-body-sm text-muted-foreground">
                  {t("setup.successGuide")}
                </p>
              )}
              <div className="flex gap-2">
                <Link
                  to="/login"
                  className="flex-1 text-center py-2 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-body-sm font-medium rounded-md transition-colors"
                >
                  {t("setup.goLogin")}
                </Link>
                <Link
                  to="/"
                  className="flex-1 text-center py-2 px-4 border border-input hover:bg-accent text-foreground text-body-sm font-medium rounded-md transition-colors"
                >
                  {t("setup.goHome")}
                </Link>
              </div>
            </div>
          )}

          {view === "form" && (
            <>
              <h1 className="text-title mb-6">{t("setup.title")}</h1>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-body-sm font-medium text-foreground mb-1.5">
                    {t("setup.secretLabel")}
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="w-full px-3 py-2 rounded-sm border border-input bg-background text-foreground text-body-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {error && <FormError>{error}</FormError>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-body-sm font-medium rounded-md transition-colors"
                >
                  {submitting ? t("setup.submitting") : t("setup.submit")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

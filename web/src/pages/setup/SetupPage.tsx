import { useState, useEffect } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Database, Globe } from "lucide-react";
import { setupApi, ApiError } from "@/lib/api";

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
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <button
          type="button"
          onClick={toggleLang}
          className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          title="Switch language"
        >
          <Globe className="w-4 h-4" />
        </button>
      </div>

      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
            <Database className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold text-foreground">
            {t("app.name")}
          </span>
        </div>

        <div className="bg-card border rounded-xl shadow-lg p-8">
          {view === "loading" && (
            <p className="text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          )}

          {view === "disabled" && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-foreground">
                {t("setup.title")}
              </h1>
              <p role="alert" className="text-sm text-muted-foreground">
                {t("setup.disabled")}
              </p>
              <Link
                to="/login"
                className="block w-full text-center py-2 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {t("setup.goLogin")}
              </Link>
            </div>
          )}

          {view === "done" && (
            <div className="space-y-4">
              <h1 className="text-lg font-semibold text-foreground">
                {t("setup.title")}
              </h1>
              <p className="text-sm text-green-600">
                {alreadyInitialized
                  ? t("setup.alreadyInitialized")
                  : t("setup.success")}
              </p>
              {!alreadyInitialized && (
                <p className="text-sm text-muted-foreground">
                  {t("setup.successGuide")}
                </p>
              )}
              <div className="flex gap-2">
                <Link
                  to="/login"
                  className="flex-1 text-center py-2 px-4 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded-md transition-colors"
                >
                  {t("setup.goLogin")}
                </Link>
                <Link
                  to="/"
                  className="flex-1 text-center py-2 px-4 border border-input hover:bg-accent text-foreground text-sm font-medium rounded-md transition-colors"
                >
                  {t("setup.goHome")}
                </Link>
              </div>
            </div>
          )}

          {view === "form" && (
            <>
              <h1 className="text-lg font-semibold text-foreground mb-1">
                {t("setup.title")}
              </h1>
              <p className="text-sm text-muted-foreground mb-6">
                {t("setup.desc")}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    {t("setup.secretLabel")}
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
                >
                  {submitting ? t("setup.submitting") : t("setup.submit")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

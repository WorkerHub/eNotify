import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { AuthShell } from "@/components/AuthShell";

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!token) {
      setStatus("error");
      setMessage(t("auth.missingToken"));
      return;
    }

    api
      .post<any>("/auth/email/verify", { token })
      .then(() => {
        setStatus("success");
        setMessage(t("auth.verifyEmailSuccess"));
      })
      .catch((err: any) => {
        setStatus("error");
        setMessage(err.message || t("common.error"));
      });
  }, [token, t]);

  return (
    <AuthShell title={t("auth.verifyEmail")}>
      <div>
        <div className="text-center">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-10 h-10 animate-spin" />
              <p className="text-body-sm">{t("auth.loading")}</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle className="w-12 h-12 text-success" />
              <p className="text-body-sm text-foreground">{message}</p>
              <Link
                to="/login"
                className="mt-4 inline-block py-2 px-6 bg-primary hover:bg-primary/90 text-primary-foreground text-body-sm font-medium rounded-md transition-colors"
              >
                {t("auth.login")}
              </Link>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3">
              <XCircle className="w-12 h-12 text-destructive" />
              <p className="text-body-sm text-destructive">{message}</p>
              <Link
                to="/login"
                className="mt-4 inline-block text-body-sm text-primary hover:underline font-medium"
              >
                {t("auth.login")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

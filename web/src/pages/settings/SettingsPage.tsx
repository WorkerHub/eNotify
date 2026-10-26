import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  User,
  Shield,
  Sliders,
  Monitor,
  CheckCircle,
  QrCode,
  Key,
  KeyRound,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  DatabaseBackup,
} from "lucide-react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/ThemeProvider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useEmailConfigured } from "@/hooks/useEmailConfigured";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PasswordPromptDialog } from "@/components/PasswordPromptDialog";
import { BackupSection } from "@/components/backup/BackupSection";
import {
  cn,
  serializeRegistrationCredential,
  prepareRegistrationOptions,
} from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId =
  | "account"
  | "security"
  | "sessions"
  | "apiKeys"
  | "backup"
  | "preferences";

function StatusBadge({ ok }: { ok: boolean }) {
  const { t } = useTranslation();
  return ok ? (
    <span className="inline-flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">
      <CheckCircle className="w-3 h-3" />
      {t("common.enabled")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
      <span className="w-3 h-3 text-muted-foreground" />
      {t("common.disabled")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Account Tab
// ---------------------------------------------------------------------------

function AccountTab() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    setPwLoading(true);
    try {
      await api.put("/me/password", { currentPassword, newPassword });
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      setPwError(err.message || t("common.error"));
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Profile info */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("settings.account")}
        </h3>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{user?.email}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {user?.role}
            </p>
          </div>
          {user?.email_verified && (
            <CheckCircle className="w-4 h-4 text-success ml-auto" />
          )}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          {t("settings.changePassword")}
        </h3>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("settings.currentPassword")}
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("settings.newPassword")}
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {pwError && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {pwError}
            </p>
          )}
          {pwSuccess && (
            <p className="text-sm text-success bg-success/10 px-3 py-2 rounded-md">
              {t("common.success")}
            </p>
          )}
          <button
            type="submit"
            disabled={pwLoading}
            className="py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
          >
            {pwLoading ? t("common.loading") : t("common.save")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security Tab
// ---------------------------------------------------------------------------

function SecurityTab() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();

  const twofa = user?.twofa;

  const { configured: emailConfigured, loading: emailInfoLoading } =
    useEmailConfigured();

  const [pendingDisable, setPendingDisable] = useState<
    "totp" | "passkey" | "email_otp" | null
  >(null);

  // TOTP setup state
  const [totpSetupData, setTotpSetupData] = useState<{
    qrCode: string;
    secret: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);

  // Passkey
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");

  // Email OTP
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState("");
  const [emailOtpVerifying, setEmailOtpVerifying] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState("");
  const [emailOtpSending, setEmailOtpSending] = useState(false);

  const startTotpSetup = async () => {
    setTotpError("");
    setTotpLoading(true);
    try {
      const res = await api.post<any>("/auth/2fa/totp/setup");
      const qrCode = await QRCode.toDataURL(res.uri);
      setTotpSetupData({ qrCode, secret: res.secret });
      setTotpCode("");
    } catch (err: any) {
      setTotpError(err.message || t("common.error"));
    } finally {
      setTotpLoading(false);
    }
  };

  const confirmTotpSetup = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTotpError("");
    setTotpLoading(true);
    try {
      await api.post("/auth/2fa/totp/enable", { code: totpCode });
      setTotpSetupData(null);
      setTotpCode("");
      await refreshUser();
    } catch (err: any) {
      setTotpError(err.message || t("common.error"));
    } finally {
      setTotpLoading(false);
    }
  };

  const disableTotp = async (password: string) => {
    setTotpLoading(true);
    try {
      await api.post("/auth/2fa/totp/disable", { password });
      await refreshUser();
    } catch (err: any) {
      setTotpError(err.message || t("common.error"));
    } finally {
      setTotpLoading(false);
    }
  };

  const registerPasskey = async () => {
    setPasskeyError("");
    setPasskeyLoading(true);
    try {
      const opts = await api.post<any>("/auth/2fa/passkey/register/options");
      const credential = await navigator.credentials.create({
        publicKey: prepareRegistrationOptions(opts),
      });
      if (!credential) throw new Error("No credential returned");
      const serialized = serializeRegistrationCredential(
        credential as PublicKeyCredential,
      );
      await api.post("/auth/2fa/passkey/register/verify", serialized);
      await refreshUser();
    } catch (err: any) {
      setPasskeyError(err.message || t("common.error"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const disablePasskey = async (password: string) => {
    setPasskeyLoading(true);
    try {
      await api.post("/auth/2fa/passkey/disable", { password });
      await refreshUser();
    } catch (err: any) {
      setPasskeyError(err.message || t("common.error"));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const sendEmailOtpVerify = async () => {
    setEmailOtpError("");
    setEmailOtpSending(true);
    try {
      await api.post("/auth/2fa/email-otp/send-verify");
      setEmailOtpVerifying(true);
      setEmailOtpCode("");
    } catch (err: any) {
      setEmailOtpError(err.message || t("common.error"));
    } finally {
      setEmailOtpSending(false);
    }
  };

  const confirmEmailOtpEnable = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setEmailOtpError("");
    setEmailOtpLoading(true);
    try {
      await api.post("/auth/2fa/email-otp/enable", { code: emailOtpCode });
      setEmailOtpVerifying(false);
      setEmailOtpCode("");
      await refreshUser();
    } catch (err: any) {
      setEmailOtpError(err.message || t("common.error"));
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const disableEmailOtp = async (password: string) => {
    setEmailOtpError("");
    setEmailOtpLoading(true);
    try {
      await api.post("/auth/2fa/email-otp/disable", { password });
      await refreshUser();
    } catch (err: any) {
      setEmailOtpError(err.message || t("common.error"));
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const submitDisable = async (password: string) => {
    const which = pendingDisable;
    setPendingDisable(null);
    if (which === "totp") await disableTotp(password);
    else if (which === "passkey") await disablePasskey(password);
    else if (which === "email_otp") await disableEmailOtp(password);
  };

  return (
    <div className="space-y-4">
      <PasswordPromptDialog
        open={pendingDisable !== null}
        title={t("settings.confirmPasswordTitle")}
        onSubmit={submitDisable}
        onCancel={() => setPendingDisable(null)}
      />
      {/* TOTP */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t("auth.totp")}
            </h3>
          </div>
          <StatusBadge ok={!!twofa?.totp_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.totpDescription")}
        </p>

        {totpError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">
            {totpError}
          </p>
        )}

        {!twofa?.totp_enabled && !totpSetupData && (
          <button
            type="button"
            onClick={startTotpSetup}
            disabled={totpLoading}
            className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
          >
            {totpLoading ? t("common.loading") : t("auth.setup2fa")}
          </button>
        )}

        {totpSetupData && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <img
                src={totpSetupData.qrCode}
                alt="TOTP QR code"
                className="w-40 h-40 rounded-md border"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground break-all bg-muted px-3 py-2 rounded-md font-mono">
              {totpSetupData.secret}
            </p>
            <form onSubmit={confirmTotpSetup} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={totpLoading || totpCode.length < 6}
                className="py-2 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {t("common.confirm")}
              </button>
            </form>
          </div>
        )}

        {twofa?.totp_enabled && (
          <button
            type="button"
            onClick={() => setPendingDisable("totp")}
            disabled={totpLoading}
            className="py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
          >
            {totpLoading ? t("common.loading") : t("common.disable")}
          </button>
        )}
      </div>

      {/* Email OTP */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t("auth.emailOtp")}
            </h3>
          </div>
          <StatusBadge ok={!!twofa?.email_otp_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.emailOtpDescription")}
        </p>

        {emailOtpError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">
            {emailOtpError}
          </p>
        )}

        {/* §3.9: an enabled email OTP record survives a site without email
            delivery (disable must stay possible), so warn instead of hiding. */}
        {!emailInfoLoading && !emailConfigured && twofa?.email_otp_enabled && (
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              {t("settings.emailOtpUnavailableWarning")}
            </p>
          </div>
        )}

        {!twofa?.email_otp_enabled &&
          !emailOtpVerifying &&
          !emailInfoLoading &&
          (emailConfigured ? (
            <button
              type="button"
              onClick={sendEmailOtpVerify}
              disabled={emailOtpSending}
              className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
            >
              {emailOtpSending ? t("common.loading") : t("common.enable")}
            </button>
          ) : (
            /* §3.9: no email delivery → no enable affordance, muted note only. */
            <p className="text-xs text-muted-foreground">
              {t("settings.emailOtpUnavailable")}
            </p>
          ))}

        {!twofa?.email_otp_enabled && emailOtpVerifying && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("settings.emailOtpVerifyPrompt")}
            </p>
            <form onSubmit={confirmEmailOtpEnable} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={emailOtpCode}
                onChange={(e) =>
                  setEmailOtpCode(e.target.value.replace(/\D/g, ""))
                }
                placeholder="000000"
                className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={emailOtpLoading || emailOtpCode.length < 6}
                className="py-2 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
              >
                {emailOtpLoading ? t("common.loading") : t("common.confirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailOtpVerifying(false);
                  setEmailOtpCode("");
                  setEmailOtpError("");
                }}
                className="py-2 px-3 bg-muted hover:bg-muted/80 text-foreground text-sm font-medium rounded-md transition-colors"
              >
                {t("common.cancel")}
              </button>
            </form>
          </div>
        )}

        {twofa?.email_otp_enabled && (
          <button
            type="button"
            onClick={() => setPendingDisable("email_otp")}
            disabled={emailOtpLoading}
            className="py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
          >
            {emailOtpLoading ? t("common.loading") : t("common.disable")}
          </button>
        )}
      </div>

      {/* Passkey */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              {t("auth.passkey")}
            </h3>
          </div>
          <StatusBadge ok={!!twofa?.passkey_enabled} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.passkeyDescription")}
        </p>

        {passkeyError && (
          <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md mb-3">
            {passkeyError}
          </p>
        )}

        {!twofa?.passkey_enabled ? (
          <button
            type="button"
            onClick={registerPasskey}
            disabled={passkeyLoading}
            className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
          >
            {passkeyLoading ? t("common.loading") : t("common.registerPasskey")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPendingDisable("passkey")}
            disabled={passkeyLoading}
            className="py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
          >
            {passkeyLoading ? t("common.loading") : t("common.disable")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions Tab
// ---------------------------------------------------------------------------

interface SessionInfo {
  jti: string;
  iat: number;
  exp: number;
  ip?: string;
  ua?: string;
  current: boolean;
}

function SessionsTab() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState("");

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.get<SessionInfo[]>("/me/sessions");
      setSessions(data);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (jti: string) => {
    setRevoking(jti);
    setError("");
    setRevokeMsg("");
    try {
      await api.delete(`/me/sessions/${jti}`);
      setRevokeMsg(t("settings.revokeSuccess"));
      setTimeout(() => setRevokeMsg(""), 3000);
      await fetchSessions();
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setRevoking(null);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t("settings.sessionsDescription")}
      </p>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}
      {revokeMsg && (
        <p className="text-sm text-success bg-success/10 px-3 py-2 rounded-md">
          {revokeMsg}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className="bg-card border rounded-lg p-5 text-center text-sm text-muted-foreground">
          {t("settings.noSessions")}
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.jti}
              className="bg-card border rounded-lg p-4 flex items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Monitor className="w-4 h-4 text-muted-foreground shrink-0" />
                  {s.current && (
                    <span className="inline-flex items-center text-xs text-success bg-success/10 px-2 py-0.5 rounded-full font-medium">
                      {t("settings.currentSession")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>
                    {t("settings.loggedInAt")}: {formatTime(s.iat)}
                  </p>
                  <p>
                    {t("settings.expiresAt")}: {formatTime(s.exp)}
                  </p>
                  {s.ip && (
                    <p>
                      {t("settings.sessionIp")}: {s.ip}
                    </p>
                  )}
                  {s.ua && (
                    <p className="truncate" title={s.ua}>
                      {t("settings.sessionUa")}: {s.ua}
                    </p>
                  )}
                </div>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => handleRevoke(s.jti)}
                  disabled={revoking === s.jti}
                  className="shrink-0 py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
                >
                  {revoking === s.jti
                    ? t("common.loading")
                    : t("settings.revoke")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Keys Tab
// ---------------------------------------------------------------------------

interface ApiKeyInfo {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

const MAX_API_KEYS = 20;
const MAX_API_KEY_DAYS = 3650;
const API_KEY_EXPIRY_PRESETS = [30, 90, 365] as const;

function ApiKeysTab() {
  const { t } = useTranslation();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("365");
  const [customDays, setCustomDays] = useState("365");
  const [creating, setCreating] = useState(false);

  const [createdKey, setCreatedKey] = useState<{
    name: string;
    key: string;
    expires_at: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const formatDate = (value: string) => new Date(value).toLocaleString();

  const fetchKeys = useCallback(async () => {
    try {
      const data = await api.get<{ keys: ApiKeyInfo[] }>("/me/api-keys");
      setKeys(data.keys ?? []);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const describeCreateError = (err: any) => {
    const msg = String(err?.message ?? "");
    if (/at most \d+ api keys/i.test(msg)) {
      return t("settings.apiKeysLimitError");
    }
    if (/expires_in_days/i.test(msg)) {
      return t("settings.apiKeysExpiryError");
    }
    if (/name must be/i.test(msg)) {
      return t("settings.apiKeysNameError");
    }
    return msg || t("common.error");
  };

  const handleCreate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setCopied(false);

    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      setError(t("settings.apiKeysNameError"));
      return;
    }

    const days = expiry === "custom" ? Number(customDays) : Number(expiry);
    if (!Number.isInteger(days) || days < 1 || days > MAX_API_KEY_DAYS) {
      setError(t("settings.apiKeysExpiryError"));
      return;
    }

    setCreating(true);
    try {
      const created = await api.post<{
        id: string;
        name: string;
        key: string;
        created_at: string;
        expires_at: string;
      }>("/me/api-keys", { name: trimmed, expires_in_days: days });
      setCreatedKey({
        name: created.name,
        key: created.key,
        expires_at: created.expires_at,
      });
      setName("");
      setSuccessMsg(t("settings.apiKeysCreateSuccess"));
      setTimeout(() => setSuccessMsg(""), 3000);
      await fetchKeys();
    } catch (err: any) {
      setError(describeCreateError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKeyInfo) => {
    setPendingRevoke(null);
    setRevoking(key.id);
    setError("");
    setSuccessMsg("");
    try {
      await api.delete(`/me/api-keys/${key.id}`);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
      setSuccessMsg(t("settings.apiKeysRevokeSuccess"));
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setRevoking(null);
    }
  };

  const copyCreatedKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("settings.apiKeysCopyFailed"));
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  const limitReached = keys.length >= MAX_API_KEYS;
  const inputCls =
    "w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={!!pendingRevoke}
        title={t("settings.apiKeysRevokeTitle")}
        message={t("settings.apiKeysRevokeConfirm", {
          name: pendingRevoke?.name ?? "",
        })}
        variant="danger"
        confirmLabel={t("settings.revoke")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (pendingRevoke) void handleRevoke(pendingRevoke);
        }}
        onCancel={() => setPendingRevoke(null)}
      />

      <p className="text-xs text-muted-foreground">
        {t("settings.apiKeysDescription")}
      </p>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}
      {successMsg && (
        <p className="text-sm text-success bg-success/10 px-3 py-2 rounded-md">
          {successMsg}
        </p>
      )}

      {/* Newly created key - shown exactly once */}
      {createdKey && (
        <div className="border border-primary/40 bg-primary/5 rounded-lg p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("settings.apiKeysCreatedTitle", { name: createdKey.name })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("settings.apiKeysOnceWarning")}
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 min-w-0 px-3 py-2 rounded-md border bg-background font-mono text-xs break-all select-all">
              {createdKey.key}
            </code>
            <button
              type="button"
              onClick={copyCreatedKey}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium rounded-md transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? t("settings.apiKeysCopied") : t("settings.apiKeysCopy")}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t("settings.apiKeysCreatedExpires", {
                date: formatDate(createdKey.expires_at),
              })}
            </p>
            <button
              type="button"
              onClick={() => setCreatedKey(null)}
              className="py-1.5 px-3 bg-muted hover:bg-muted/80 text-foreground text-xs font-medium rounded-md transition-colors"
            >
              {t("settings.apiKeysSaved")}
            </button>
          </div>
        </div>
      )}

      {/* Create key */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {t("settings.apiKeysCreate")}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.apiKeysCreateDescription")}
        </p>

        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label
              htmlFor="api-key-name"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t("settings.apiKeysName")}
            </label>
            <input
              id="api-key-name"
              type="text"
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.apiKeysNamePlaceholder")}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.apiKeysNameHint")}
            </p>
          </div>

          <div>
            <label
              htmlFor="api-key-expiry"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              {t("settings.apiKeysExpiry")}
            </label>
            <select
              id="api-key-expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className={inputCls}
            >
              {API_KEY_EXPIRY_PRESETS.map((days) => (
                <option key={days} value={String(days)}>
                  {t("settings.apiKeysDays", { days })}
                </option>
              ))}
              <option value="custom">
                {t("settings.apiKeysExpiryCustom")}
              </option>
            </select>
            {expiry === "custom" && (
              <div className="mt-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_API_KEY_DAYS}
                  step={1}
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  aria-label={t("settings.apiKeysExpiryCustom")}
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.apiKeysExpiryCustomHint")}
                </p>
              </div>
            )}
          </div>

          {limitReached && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {t("settings.apiKeysLimitReached", { max: MAX_API_KEYS })}
            </p>
          )}

          <button
            type="submit"
            disabled={creating || limitReached}
            className="w-full sm:w-auto py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
          >
            {creating ? t("common.loading") : t("settings.apiKeysCreate")}
          </button>
        </form>
      </div>

      {/* Existing keys */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("settings.apiKeysExisting")}
          </h3>
          <span className="text-xs text-muted-foreground">
            {keys.length} / {MAX_API_KEYS}
          </span>
        </div>

        {keys.length === 0 ? (
          <div className="bg-card border rounded-lg p-5 text-center text-sm text-muted-foreground">
            {t("settings.apiKeysEmpty")}
          </div>
        ) : (
          keys.map((k) => {
            const expired = new Date(k.expires_at).getTime() <= Date.now();
            return (
              <div key={k.id} className="bg-card border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium text-foreground break-all">
                        {k.name}
                      </p>
                      {expired && (
                        <span className="inline-flex items-center text-xs text-warning bg-warning/10 px-2 py-0.5 rounded-full font-medium">
                          {t("settings.apiKeysExpired")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>
                        {t("settings.apiKeysCreatedAt")}:{" "}
                        {formatDate(k.created_at)}
                      </p>
                      <p>
                        {t("settings.apiKeysExpiresAt")}:{" "}
                        {formatDate(k.expires_at)}
                      </p>
                      <p>
                        {t("settings.apiKeysLastUsed")}:{" "}
                        {k.last_used_at
                          ? formatDate(k.last_used_at)
                          : t("settings.apiKeysNeverUsed")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingRevoke(k)}
                    disabled={revoking === k.id}
                    className="shrink-0 py-1.5 px-3 bg-destructive/10 hover:bg-destructive/20 disabled:opacity-50 text-destructive text-xs font-medium rounded-md transition-colors"
                  >
                    {revoking === k.id
                      ? t("common.loading")
                      : t("settings.revoke")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preferences Tab
// ---------------------------------------------------------------------------

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (EST/EDT)" },
  { value: "America/Chicago", label: "Chicago (CST/CDT)" },
  { value: "America/Denver", label: "Denver (MST/MDT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PST/PDT)" },
  { value: "America/Anchorage", label: "Anchorage (AKST)" },
  { value: "Pacific/Honolulu", label: "Honolulu (HST)" },
  { value: "America/Toronto", label: "Toronto (EST/EDT)" },
  { value: "America/Vancouver", label: "Vancouver (PST/PDT)" },
  { value: "America/Mexico_City", label: "Mexico City (CST/CDT)" },
  { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Europe/Madrid", label: "Madrid (CET/CEST)" },
  { value: "Europe/Rome", label: "Rome (CET/CEST)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET/CEST)" },
  { value: "Europe/Stockholm", label: "Stockholm (CET/CEST)" },
  { value: "Europe/Moscow", label: "Moscow (MSK)" },
  { value: "Europe/Istanbul", label: "Istanbul (TRT)" },
  { value: "Africa/Cairo", label: "Cairo (EET)" },
  { value: "Africa/Lagos", label: "Lagos (WAT)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Karachi", label: "Karachi (PKT)" },
  { value: "Asia/Kolkata", label: "Mumbai / Kolkata (IST)" },
  { value: "Asia/Dhaka", label: "Dhaka (BST)" },
  { value: "Asia/Bangkok", label: "Bangkok (ICT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Shanghai", label: "上海 / Shanghai (CST)" },
  { value: "Asia/Hong_Kong", label: "香港 / Hong Kong (HKT)" },
  { value: "Asia/Taipei", label: "台北 / Taipei (CST)" },
  { value: "Asia/Tokyo", label: "東京 / Tokyo (JST)" },
  { value: "Asia/Seoul", label: "서울 / Seoul (KST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
  { value: "Australia/Melbourne", label: "Melbourne (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "Auckland (NZST/NZDT)" },
];

const CURRENCIES = [
  "USD",
  "EUR",
  "CNY",
  "JPY",
  "GBP",
  "HKD",
  "CAD",
  "AUD",
  "SGD",
  "KRW",
];

function PreferencesTab() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();

  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");
  const [baseCurrency, setBaseCurrency] = useState(
    user?.base_currency ?? "USD",
  );
  const [language, setLanguage] = useState(user?.language ?? "en");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      setTimezone(user.timezone ?? "UTC");
      setBaseCurrency(user.base_currency ?? "USD");
      setLanguage(user.language ?? "en");
    }
  }, [user]);

  const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setSaving(true);
    try {
      await api.put("/me", {
        timezone,
        base_currency: baseCurrency,
        language,
        theme,
      });
      await refreshUser();
      if (i18n.language !== language) {
        i18n.changeLanguage(language);
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Theme */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("settings.theme")}
        </h3>
        <div className="flex flex-wrap gap-2">
          {(["light", "dark", "system"] as const).map((t_) => (
            <label key={t_} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="theme"
                value={t_}
                checked={theme === t_}
                onChange={() => setTheme(t_)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">
                {t(`settings.theme${t_.charAt(0).toUpperCase() + t_.slice(1)}`)}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("settings.language")}
        </h3>
        <div className="flex gap-4">
          {[
            { code: "en", label: "English" },
            { code: "zh", label: "中文" },
          ].map(({ code, label }) => (
            <label
              key={code}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                name="language"
                value={code}
                checked={language === code}
                onChange={() => setLanguage(code)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Timezone */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("settings.timezone")}
        </h3>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className={inputCls}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      {/* Base currency */}
      <div className="bg-card border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {t("settings.baseCurrency")}
        </h3>
        <select
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
          className={inputCls}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-success bg-success/10 px-3 py-2 rounded-md">
          {t("common.success")}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="py-2 px-4 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-md transition-colors"
      >
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  const validTabs: TabId[] = [
    "account",
    "security",
    "apiKeys",
    "backup",
    "sessions",
    "preferences",
  ];
  const rawTab = searchParams.get("tab") as TabId | null;
  const hasExplicitTab = rawTab && validTabs.includes(rawTab);
  const showMenu = !hasExplicitTab && isMobile;
  const activeTab: TabId = hasExplicitTab ? rawTab! : "account";

  const setTab = (tab: TabId) => {
    setSearchParams({ tab });
  };

  // Sliding underline for the desktop tab bar (contract §5: 200ms,
  // transform/width-only). Position is measured from the active button so
  // label-length / language changes re-center correctly.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const [underline, setUnderline] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const btn = tabRefs.current[activeTab];
    const bar = tabBarRef.current;
    if (!btn || !bar) return;
    const b = btn.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    setUnderline({ left: b.left - r.left + bar.scrollLeft, width: b.width });
  }, [activeTab]);

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    {
      id: "account",
      label: t("settings.account"),
      icon: <User className="w-4 h-4" />,
    },
    {
      id: "security",
      label: t("settings.security"),
      icon: <Shield className="w-4 h-4" />,
    },
    {
      id: "apiKeys",
      label: t("settings.apiKeys"),
      icon: <KeyRound className="w-4 h-4" />,
    },
    {
      id: "backup",
      label: t("settings.backup"),
      icon: <DatabaseBackup className="w-4 h-4" />,
    },
    {
      id: "sessions",
      label: t("settings.sessions"),
      icon: <Monitor className="w-4 h-4" />,
    },
    {
      id: "preferences",
      label: t("settings.preferences"),
      icon: <Sliders className="w-4 h-4" />,
    },
  ];

  const menuItems = [
    { id: "account" as TabId, label: t("settings.account"), icon: User },
    { id: "security" as TabId, label: t("settings.security"), icon: Shield },
    { id: "apiKeys" as TabId, label: t("settings.apiKeys"), icon: KeyRound },
    {
      id: "backup" as TabId,
      label: t("settings.backup"),
      icon: DatabaseBackup,
    },
    { id: "sessions" as TabId, label: t("settings.sessions"), icon: Monitor },
    {
      id: "preferences" as TabId,
      label: t("settings.preferences"),
      icon: Sliders,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Mobile sub-menu */}
      {showMenu && (
        <div className="md:hidden">
          <h1 className="text-heading text-foreground mb-6">
            {t("settings.title")}
          </h1>
          <div className="rounded-lg border overflow-hidden divide-y">
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 bg-card hover:bg-accent transition-colors"
              >
                <item.icon className="w-5 h-5 text-muted-foreground" />
                <span className="flex-1 text-left text-body-sm text-foreground">
                  {item.label}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className={showMenu ? "hidden md:block" : ""}>
        {!isMobile && (
          <h1 className="text-heading text-foreground mb-6">
            {t("settings.title")}
          </h1>
        )}

        {/* Tab bar - desktop only: shared underline slides to the active tab
            (contract §5: 200ms ease-out, transform/width-only) */}
        <div
          ref={tabBarRef}
          className="relative hidden md:flex gap-1 border-b mb-6 overflow-x-auto no-scrollbar"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              onClick={() => setTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-body-sm whitespace-nowrap -mb-px transition-colors duration-(--duration-standard) ease-(--ease-standard) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                activeTab === tab.id
                  ? "text-primary font-semibold"
                  : "text-muted-foreground font-medium hover:text-foreground",
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <span
            aria-hidden="true"
            className="absolute bottom-0 h-0.5 rounded-full bg-primary transition-[transform,width] duration-(--duration-standard) ease-(--ease-out)"
            style={{
              width: underline.width,
              transform: `translateX(${underline.left}px)`,
            }}
          />
        </div>

        {/* Tab content */}
        {activeTab === "account" && <AccountTab />}
        {activeTab === "security" && <SecurityTab />}
        {activeTab === "apiKeys" && <ApiKeysTab />}
        {activeTab === "backup" && <BackupSection scope="user" />}
        {activeTab === "sessions" && <SessionsTab />}
        {activeTab === "preferences" && <PreferencesTab />}
      </div>
    </div>
  );
}

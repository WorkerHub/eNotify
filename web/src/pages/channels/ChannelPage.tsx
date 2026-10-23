import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Clock, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NotificationHoursSelector } from "@/components/NotificationHoursSelector";
import type { NotificationConfig } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelFieldDef {
  key: string;
  /** Fallback label, used when no i18n key is given. */
  label: string;
  /** i18n key for the label (e.g. "channels.smtpHost"). */
  labelKey?: string;
  /** i18n key for a helper line rendered under the input. */
  hintKey?: string;
  type: "text" | "password" | "textarea" | "select";
  options?: string[];
  placeholder?: string;
  inputMode?: "text" | "numeric";
  /** Trim surrounding whitespace before submitting (values stay strings). */
  trim?: boolean;
}

interface ChannelDef {
  id: string;
  label: string;
  /** i18n key for a helper line rendered above the fields. */
  hintKey?: string;
  fields: ChannelFieldDef[];
}

// ---------------------------------------------------------------------------
// Channel definitions
// ---------------------------------------------------------------------------

const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    fields: [
      { key: "bot_token", label: "Bot Token", type: "password" },
      { key: "chat_id", label: "Chat ID", type: "text" },
    ],
  },
  {
    id: "webhook",
    label: "Webhook",
    fields: [
      { key: "url", label: "URL", type: "text", placeholder: "https://" },
      {
        key: "method",
        label: "Method",
        type: "select",
        options: ["POST", "GET", "PUT"],
      },
      {
        key: "headers",
        label: "Headers (JSON)",
        type: "textarea",
        placeholder: '{"Authorization": "Bearer ..."}',
      },
      { key: "template", label: "Body Template", type: "textarea" },
    ],
  },
  {
    id: "wechatbot",
    label: "WeCom Bot",
    fields: [
      {
        key: "webhook",
        label: "Webhook URL",
        type: "password",
        placeholder: "https://",
      },
      {
        key: "msg_type",
        label: "Message Type",
        type: "select",
        options: ["markdown", "text"],
      },
      {
        key: "at_all",
        label: "At All",
        type: "select",
        options: ["false", "true"],
      },
    ],
  },
  {
    id: "email",
    label: "Email",
    hintKey: "channels.emailSmtpHint",
    fields: [
      {
        key: "to",
        label: "To Address",
        labelKey: "channels.toAddress",
        type: "text",
        placeholder: "<EMAIL_ADDRESS>",
        trim: true,
      },
      {
        key: "from_name",
        label: "From Name (optional)",
        labelKey: "channels.fromName",
        type: "text",
        trim: true,
      },
      {
        key: "smtp_host",
        label: "SMTP Host",
        labelKey: "channels.smtpHost",
        type: "text",
        placeholder: "smtp.example.com",
        trim: true,
      },
      {
        // Kept as a string end to end: the API contract takes smtp_port as a
        // string and converts it to a number when sending.
        key: "smtp_port",
        label: "SMTP Port",
        labelKey: "channels.smtpPort",
        type: "text",
        placeholder: "465",
        inputMode: "numeric",
        trim: true,
      },
      {
        key: "smtp_username",
        label: "SMTP Username",
        labelKey: "channels.smtpUsername",
        type: "text",
        placeholder: "user@example.com",
        trim: true,
      },
      {
        key: "smtp_password",
        label: "SMTP Password",
        labelKey: "channels.smtpPassword",
        type: "password",
        hintKey: "channels.smtpPasswordHint",
      },
      {
        key: "smtp_from",
        label: "From Address",
        labelKey: "channels.smtpFrom",
        type: "text",
        placeholder: "sender@example.com",
        trim: true,
      },
    ],
  },
  {
    id: "bark",
    label: "Bark",
    fields: [
      { key: "device_key", label: "Device Key", type: "text" },
      {
        key: "server",
        label: "Server (optional)",
        type: "text",
        placeholder: "https://api.day.app",
      },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        type: "password",
        placeholder: "https://hooks.slack.com/services/...",
      },
    ],
  },
  {
    id: "feishu",
    label: "Lark Bot",
    hintKey: "channels.feishuHint",
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        type: "password",
        placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...",
      },
      {
        key: "secret",
        label: "Sign Secret (optional)",
        type: "password",
      },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        type: "password",
        placeholder: "https://discord.com/api/webhooks/...",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function FormField({
  def,
  value,
  onChange,
}: {
  def: ChannelFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const base =
    "w-full px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  if (def.type === "textarea") {
    return (
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(base, "resize-none")}
        placeholder={def.placeholder}
      />
    );
  }
  if (def.type === "select" && def.options) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      >
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={def.type === "password" ? "password" : "text"}
      inputMode={def.inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={base}
      placeholder={def.placeholder}
    />
  );
}

// ---------------------------------------------------------------------------
// ChannelCard
// ---------------------------------------------------------------------------

function ChannelCard({
  channel,
  config,
  onConfigChange,
}: {
  channel: ChannelDef;
  config: NotificationConfig;
  onConfigChange: (updated: NotificationConfig) => void;
}) {
  const { t } = useTranslation();

  const isEnabled = config.enabled_channels.includes(channel.id);
  // API returns channel config under `${channel.id}_config` key
  const configKey = `${channel.id}_config` as keyof NotificationConfig;
  const channelConfig = (config[configKey] as Record<string, string>) ?? {};

  const [expanded, setExpanded] = useState(false);
  const [localFields, setLocalFields] =
    useState<Record<string, string>>(channelConfig);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  // Sync if parent config changes (only from server, not local edits)
  const configJson = JSON.stringify(
    (config[configKey] as Record<string, string>) ?? {},
  );
  useEffect(() => {
    setLocalFields(JSON.parse(configJson));
  }, [configJson]);

  const toggleEnabled = async () => {
    const next: NotificationConfig = {
      ...config,
      enabled_channels: isEnabled
        ? config.enabled_channels.filter((c) => c !== channel.id)
        : [...config.enabled_channels, channel.id],
    };
    try {
      await api.put("/me/notifications", {
        enabled_channels: next.enabled_channels,
      });
      onConfigChange(next);
    } catch {
      // no state change on error
    }
  };

  const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    const payload: Record<string, string> = { ...localFields };
    for (const field of channel.fields) {
      if (field.trim && typeof payload[field.key] === "string") {
        payload[field.key] = payload[field.key].trim();
      }
    }
    try {
      await api.put("/me/notifications", { [configKey]: payload });
      setLocalFields(payload);
      const next: NotificationConfig = { ...config, [configKey]: payload };
      onConfigChange(next);
      setFeedback({ ok: true, msg: t("common.success") });
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t("common.error") });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      await api.post("/me/notifications/test", { channel: channel.id });
      setFeedback({ ok: true, msg: t("common.success") });
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t("common.error") });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-card border rounded-lg shadow-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Toggle switch */}
          <button
            type="button"
            onClick={toggleEnabled}
            className={cn(
              "relative shrink-0 w-10 h-6 cursor-pointer rounded-full transition-colors",
              isEnabled ? "bg-primary" : "bg-input",
            )}
            role="switch"
            aria-checked={isEnabled}
          >
            <span
              className={cn(
                "pointer-events-none absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                isEnabled ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
          <span className="text-title">{channel.label}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-caption font-medium",
              isEnabled
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {isEnabled ? t("common.enabled") : t("common.disabled")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-3">
          {channel.hintKey && (
            <p className="text-xs text-muted-foreground">
              {t(channel.hintKey)}
            </p>
          )}
          <form onSubmit={handleSave} className="space-y-3">
            {channel.fields.map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-foreground mb-1">
                  {field.labelKey ? t(field.labelKey) : field.label}
                </label>
                <FormField
                  def={field}
                  value={localFields[field.key] ?? ""}
                  onChange={(v) =>
                    setLocalFields((p) => ({ ...p, [field.key]: v }))
                  }
                />
                {field.hintKey && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t(field.hintKey)}
                  </p>
                )}
              </div>
            ))}

            {feedback && (
              <p
                className={cn(
                  "text-xs px-3 py-2 rounded-md",
                  feedback.ok
                    ? "text-success bg-success/10"
                    : "text-destructive bg-destructive/10",
                )}
              >
                {feedback.msg}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
              >
                {saving ? t("common.loading") : t("common.save")}
              </button>
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="py-1.5 px-3 bg-secondary hover:bg-secondary/80 disabled:opacity-50 text-secondary-foreground text-xs font-medium rounded-md transition-colors"
              >
                {testing ? t("common.loading") : t("common.test")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationHoursTab
// ---------------------------------------------------------------------------

type ChannelTabId = "hours" | "channels";

function NotificationHoursTab({
  config,
  onConfigChange,
}: {
  config: NotificationConfig;
  onConfigChange: (updated: NotificationConfig) => void;
}) {
  const { t } = useTranslation();
  const [localHours, setLocalHours] = useState<number[]>(
    config.notification_hours ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  useEffect(() => {
    setLocalHours(config.notification_hours ?? []);
  }, [config.notification_hours]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.put("/me/notifications", { notification_hours: localHours });
      onConfigChange({ ...config, notification_hours: localHours });
      setFeedback({ ok: true, msg: t("common.success") });
    } catch (err: any) {
      setFeedback({ ok: false, msg: err.message || t("common.error") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg shadow-1 p-4 md:p-6 space-y-4">
        <p className="text-xs text-muted-foreground">
          {t("channels.notificationHoursHint")}
        </p>

        <NotificationHoursSelector
          selected={localHours}
          onChange={setLocalHours}
          showTimezone={true}
        />

        {feedback && (
          <p
            className={cn(
              "text-xs px-3 py-2 rounded-md",
              feedback.ok
                ? "text-success bg-success/10"
                : "text-destructive bg-destructive/10",
            )}
          >
            {feedback.msg}
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="py-1.5 px-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors"
        >
          {saving ? t("common.loading") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelsTab
// ---------------------------------------------------------------------------

function ChannelsTab({
  config,
  onConfigChange,
}: {
  config: NotificationConfig;
  onConfigChange: (updated: NotificationConfig) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("channels.description")}
      </p>
      {CHANNELS.map((ch) => (
        <ChannelCard
          key={ch.id}
          channel={ch}
          config={config}
          onConfigChange={onConfigChange}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelPage
// ---------------------------------------------------------------------------

export function ChannelPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ChannelTabId>("hours");

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.get<NotificationConfig>("/me/notifications");
      setConfig(data);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
    );
  }
  if (error || !config) {
    return (
      <p className="text-sm text-destructive">{error || t("common.error")}</p>
    );
  }

  const tabs: { id: ChannelTabId; label: string; icon: React.ReactNode }[] = [
    {
      id: "hours",
      label: t("channels.notificationHours"),
      icon: <Clock className="w-4 h-4" />,
    },
    {
      id: "channels",
      label: t("channels.title"),
      icon: <Radio className="w-4 h-4" />,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-heading">{t("channels.title")}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-body-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground font-medium hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "hours" && (
        <NotificationHoursTab config={config} onConfigChange={setConfig} />
      )}
      {activeTab === "channels" && (
        <ChannelsTab config={config} onConfigChange={setConfig} />
      )}
    </div>
  );
}

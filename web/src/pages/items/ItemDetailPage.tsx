import {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  AlertCircle,
  Bell,
  Trash2,
  Pencil,
  Check,
  X,
  HelpCircle,
  Calculator,
} from "lucide-react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Portal } from "@/components/Portal";
import { cn } from "@/lib/utils";
import type { Item, Payment } from "@/types";
import { formatLunarDate, solarToLunar, lunarToSolar } from "@/lib/lunar";
import { ChannelSelector } from "@/components/ChannelSelector";
import { NotificationHoursSelector } from "@/components/NotificationHoursSelector";
import { TagCombobox } from "@/components/TagCombobox";

const CURRENCIES = [
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "TWD",
  "KRW",
  "TRY",
];

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addPeriod(
  date: string,
  value: number,
  unit: "day" | "week" | "month" | "year",
): string {
  const d = new Date(date + "T00:00:00Z");
  if (unit === "day") {
    d.setUTCDate(d.getUTCDate() + value);
  } else if (unit === "week") {
    d.setUTCDate(d.getUTCDate() + value * 7);
  } else if (unit === "month") {
    const origDay = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + value);
    if (d.getUTCDate() !== origDay) d.setUTCDate(0);
  } else {
    const origDay = d.getUTCDate();
    d.setUTCFullYear(d.getUTCFullYear() + value);
    if (d.getUTCDate() !== origDay) d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

function addLunarPeriod(
  solarDate: string,
  value: number,
  unit: "day" | "week" | "month" | "year",
): string | null {
  if (unit === "day" || unit === "week")
    return addPeriod(solarDate, value, unit);
  const [y, m, d] = solarDate.split("-").map(Number);
  const lunar = solarToLunar(y, m, d);
  if (!lunar) return null;
  let newYear = lunar.lunarYear;
  let newMonth = lunar.month;
  if (unit === "month") {
    newMonth += value;
    while (newMonth > 12) {
      newMonth -= 12;
      newYear++;
    }
  } else {
    newYear += value;
  }
  let solar = lunarToSolar(newYear, newMonth, lunar.day, lunar.isLeap);
  if (!solar) solar = lunarToSolar(newYear, newMonth, lunar.day, false);
  if (!solar && lunar.day === 30) {
    solar = lunarToSolar(newYear, newMonth, 29, lunar.isLeap);
    if (!solar) solar = lunarToSolar(newYear, newMonth, 29, false);
  }
  if (!solar) return null;
  return `${solar.year}-${String(solar.month).padStart(2, "0")}-${String(solar.day).padStart(2, "0")}`;
}

const INPUT =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow";
const SELECT = cn(INPUT, "cursor-pointer");

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function FieldWithTooltip({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const updatePos = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="text-sm font-medium">{label}</label>
        <span
          ref={ref}
          className="inline-flex ml-0.5"
          onMouseEnter={updatePos}
          onMouseLeave={() => setPos(null)}
        >
          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
          {pos && (
            <Portal>
              <div
                className="fixed px-3 py-2 rounded-lg text-xs bg-popover text-popover-foreground border shadow-lg pointer-events-none z-[100] w-80 whitespace-normal"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: "translate(-50%, calc(-100% - 8px))",
                }}
              >
                {tooltip.split("\n").map((line, i) => (
                  <span key={`${line}-${i + 1}`}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </div>
            </Portal>
          )}
        </span>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative w-10 h-6 rounded-full transition-colors",
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
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

interface EditPaymentState {
  id: string;
  date: string;
  amount: string;
  note: string;
}

export function ItemDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [item, setItem] = useState<Item | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [notificationHours, setNotificationHours] = useState<number[]>([]);
  const [tags, setTags] = useState<string[]>([]);

  // Renew form
  const [renewAmount, setRenewAmount] = useState("");
  const [renewDate, setRenewDate] = useState("");
  const [renewMultiplier, setRenewMultiplier] = useState("1");
  const [renewNote, setRenewNote] = useState("");
  const [renewing, setRenewing] = useState(false);

  // Test notify
  const [notifying, setNotifying] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState("");
  const [notifyError, setNotifyError] = useState(false);

  // Reset cycle
  const [resetting, setResetting] = useState(false);

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    message: string;
    variant: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  // Inline payment edit
  const [editingPayment, setEditingPayment] = useState<EditPaymentState | null>(
    null,
  );

  useEffect(() => {
    api
      .get<{ categories: string[] }>("/items/tags")
      .then((r) => setTags(r.categories || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<Item>(`/items/${id}`),
      api.get<Payment[]>(`/items/${id}/payments`),
    ])
      .then(([s, p]) => {
        setItem(s);
        setPayments(p);
        setRenewAmount(String(s.amount ?? ""));
        setRenewDate(getTodayStr());
        // Parse channels from the item
        try {
          const parsedChannels = JSON.parse(s.channels || "[]");
          setChannels(Array.isArray(parsedChannels) ? parsedChannels : []);
        } catch {
          setChannels([]);
        }
        // Parse notification_hours from the item
        try {
          const parsedHours = JSON.parse(s.notification_hours || "[]");
          setNotificationHours(Array.isArray(parsedHours) ? parsedHours : []);
        } catch {
          setNotificationHours([]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!item) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await api.put(`/items/${id}`, {
        name: item.name,
        item_kind: item.item_kind,
        item_mode: item.item_mode,
        category: item.category,
        start_date: item.start_date,
        expiry_date: item.expiry_date,
        period_value: item.period_value,
        period_unit: item.period_unit,
        reminder_unit: item.reminder_unit,
        reminder_value: item.reminder_value,
        notes: item.notes,
        amount: item.amount,
        currency: item.currency,
        is_active: item.is_active ? 1 : 0,
        auto_renew: item.auto_renew ? 1 : 0,
        calendar_mode: item.calendar_mode,
        channels,
        notification_hours: notificationHours,
      });
      setSaveMsg(t("common.success"));
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalcExpiry = () => {
    if (!item?.start_date) return;
    const pv = item.period_value || 1;
    const today = getTodayStr();

    if (item.calendar_mode === "both") {
      // Solar and lunar tracks advance independently from start_date
      let solarDate = addPeriod(item.start_date, pv, item.period_unit);
      while (solarDate < today) {
        solarDate = addPeriod(solarDate, pv, item.period_unit);
      }

      let lunarDate = addLunarPeriod(item.start_date, pv, item.period_unit);
      while (lunarDate && lunarDate < today) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, item.period_unit) ??
          addPeriod(lunarDate, pv, item.period_unit);
      }

      setField("expiry_date", solarDate);
      setField(
        "lunar_expiry_date",
        lunarDate && lunarDate <= solarDate ? lunarDate : null,
      );
    } else if (item.calendar_mode === "lunar") {
      let lunarDate =
        addLunarPeriod(item.start_date, pv, item.period_unit) ??
        addPeriod(item.start_date, pv, item.period_unit);
      let iter = 0;
      while (lunarDate < today && iter < 1000) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, item.period_unit) ??
          addPeriod(lunarDate, pv, item.period_unit);
        iter++;
      }
      setField("expiry_date", lunarDate);
    } else {
      let solarDate = addPeriod(item.start_date, pv, item.period_unit);
      let iter = 0;
      while (solarDate < today && iter < 1000) {
        solarDate = addPeriod(solarDate, pv, item.period_unit);
        iter++;
      }
      setField("expiry_date", solarDate);
    }
  };

  const handleDelete = () => {
    setConfirm({
      message: t("common.confirmDelete", { name: item?.name }),
      variant: "danger",
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/items/${id}`);
          navigate("/items");
        } catch (e: any) {
          setError(e.message);
        }
      },
    });
  };

  const handleRenew = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setConfirm({
      message: t("items.renewConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setRenewing(true);
        try {
          const res = await api.post<{ new_expiry_date: string }>(
            `/items/${id}/renew`,
            {
              amount: renewAmount ? Number(renewAmount) : undefined,
              date: renewDate || undefined,
              multiplier: Number(renewMultiplier) || 1,
              note: renewNote || undefined,
            },
          );
          setItem((prev) =>
            prev ? { ...prev, expiry_date: res.new_expiry_date } : prev,
          );
          const updated = await api.get<Payment[]>(`/items/${id}/payments`);
          setPayments(updated);
          setRenewNote("");
          setRenewDate(getTodayStr());
          setRenewMultiplier("1");
        } catch (e: any) {
          setError(e.message);
        } finally {
          setRenewing(false);
        }
      },
    });
  };

  const handleTestNotify = () => {
    setConfirm({
      message: t("items.testNotifyConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setNotifying(true);
        setNotifyMsg("");
        setNotifyError(false);
        try {
          await api.post(`/items/${id}/test-notify`);
          setNotifyMsg(t("common.notificationSent"));
          setTimeout(() => setNotifyMsg(""), 3000);
        } catch (e: any) {
          setNotifyMsg(e.message);
          setNotifyError(true);
        } finally {
          setNotifying(false);
        }
      },
    });
  };

  const handleResetSubmit = async (
    e: React.SyntheticEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    setConfirm({
      message: t("items.resetConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setResetting(true);
        try {
          const res = await api.post<{ new_expiry_date: string }>(
            `/items/${id}/reset`,
            {
              amount: renewAmount ? Number(renewAmount) : undefined,
              date: renewDate || undefined,
              note: renewNote || undefined,
            },
          );
          setItem((prev) =>
            prev
              ? {
                  ...prev,
                  expiry_date: res.new_expiry_date,
                  last_payment_date: new Date().toISOString(),
                }
              : prev,
          );
          const updated = await api.get<Payment[]>(`/items/${id}/payments`);
          setPayments(updated);
          setRenewNote("");
          setRenewDate(getTodayStr());
        } catch (e: any) {
          setError(e.message);
        } finally {
          setResetting(false);
        }
      },
    });
  };

  const handleSavePayment = async () => {
    if (!editingPayment) return;
    try {
      await api.put(`/items/${id}/payments/${editingPayment.id}`, {
        date: editingPayment.date,
        amount: Number(editingPayment.amount),
        note: editingPayment.note,
      });
      setPayments((prev) =>
        prev.map((p) =>
          p.id === editingPayment.id
            ? {
                ...p,
                date: editingPayment.date,
                amount: Number(editingPayment.amount),
                note: editingPayment.note,
              }
            : p,
        ),
      );
      setEditingPayment(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeletePayment = (pid: string) => {
    setConfirm({
      message: t("common.confirmDeletePayment"),
      variant: "danger",
      onConfirm: async () => {
        setConfirm(null);
        try {
          const res = await api.delete<{
            success: boolean;
            new_expiry_date?: string;
          }>(`/items/${id}/payments/${pid}`);
          const updated = await api.get<Payment[]>(`/items/${id}/payments`);
          setPayments(updated);
          if (res.new_expiry_date) {
            setItem((prev) =>
              prev ? { ...prev, expiry_date: res.new_expiry_date! } : prev,
            );
          }
        } catch (e: any) {
          setError(e.message);
        }
      },
    });
  };

  const setField = useCallback(
    <K extends keyof Item>(key: K, val: Item[K]) =>
      setItem((prev) => (prev ? { ...prev, [key]: val } : prev)),
    [],
  );

  // Auto-recalculate expiry dates when start_date / period changes in lunar/both mode
  const derivedExpiry = useMemo(() => {
    if (!item?.start_date) return null;
    const pv = item.period_value || 1;
    const today = getTodayStr();

    if (item.calendar_mode === "both") {
      let solarDate = addPeriod(item.start_date, pv, item.period_unit);
      while (solarDate < today)
        solarDate = addPeriod(solarDate, pv, item.period_unit);

      let lunarDate = addLunarPeriod(item.start_date, pv, item.period_unit);
      while (lunarDate && lunarDate < today) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, item.period_unit) ??
          addPeriod(lunarDate, pv, item.period_unit);
      }

      return { solar: solarDate, lunar: lunarDate };
    }

    if (item.calendar_mode === "lunar") {
      let lunarDate =
        addLunarPeriod(item.start_date, pv, item.period_unit) ??
        addPeriod(item.start_date, pv, item.period_unit);
      while (lunarDate < today) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, item.period_unit) ??
          addPeriod(lunarDate, pv, item.period_unit);
      }
      return { solar: lunarDate, lunar: null as string | null };
    }

    let solarDate = addPeriod(item.start_date, pv, item.period_unit);
    while (solarDate < today)
      solarDate = addPeriod(solarDate, pv, item.period_unit);
    return { solar: solarDate, lunar: null as string | null };
  }, [
    item?.start_date,
    item?.period_value,
    item?.period_unit,
    item?.calendar_mode,
  ]);

  useEffect(() => {
    if (!item || !derivedExpiry) return;
    // Only auto-sync in both/lunar mode; in solar mode the user may freely edit expiry_date
    if (item.calendar_mode === "both") {
      if (item.expiry_date !== derivedExpiry.solar)
        setField("expiry_date", derivedExpiry.solar);
      const expectedLunar =
        derivedExpiry.lunar && derivedExpiry.lunar <= derivedExpiry.solar
          ? derivedExpiry.lunar
          : null;
      if (item.lunar_expiry_date !== expectedLunar)
        setField("lunar_expiry_date", expectedLunar);
    } else if (item.calendar_mode === "lunar") {
      if (item.expiry_date !== derivedExpiry.solar)
        setField("expiry_date", derivedExpiry.solar);
    }
  }, [item, derivedExpiry, setField]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-muted rounded w-48" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {error || t("items.notFound")}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/items")}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold truncate">{item.name}</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-destructive p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Edit form */}
      <section className="bg-card rounded-xl border p-5 space-y-5">
        <h2 className="font-semibold text-base">{t("common.edit")}</h2>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Kind (read-only) */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("items.kind")}：
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-muted text-foreground">
              {item.item_kind === "subscription"
                ? t("items.kindSubscription")
                : t("items.kindRegular")}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t("items.name")}>
              <input
                className={INPUT}
                value={item.name}
                onChange={(e) => setField("name", e.target.value)}
                required
              />
            </Field>

            <FieldWithTooltip
              label={t("items.mode.label")}
              tooltip={t("items.mode.tooltip")}
            >
              <select
                className={SELECT}
                value={item.item_mode}
                onChange={(e) => setField("item_mode", e.target.value as any)}
              >
                <option value="cycle">{t("items.mode.cycle")}</option>
                <option value="reset">{t("items.mode.reset")}</option>
              </select>
            </FieldWithTooltip>

            <FieldWithTooltip
              label={t("items.category")}
              tooltip={t("items.categoryTooltip")}
            >
              <TagCombobox
                value={item.category}
                onChange={(v) => setField("category", v)}
                options={tags}
              />
            </FieldWithTooltip>

            <Field label={t("items.startDate")}>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className={cn(INPUT, "flex-1")}
                  value={item.start_date ?? ""}
                  onChange={(e) =>
                    setField("start_date", e.target.value || null)
                  }
                />
                {item.calendar_mode !== "solar" && item.start_date && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatLunarDate(item.start_date)}
                  </span>
                )}
              </div>
            </Field>

            <Field label={t("items.period")}>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className={cn(INPUT, "w-24")}
                  value={item.period_value}
                  onChange={(e) =>
                    setField("period_value", Number(e.target.value))
                  }
                />
                <select
                  className={SELECT}
                  value={item.period_unit}
                  onChange={(e) =>
                    setField("period_unit", e.target.value as any)
                  }
                >
                  {item.calendar_mode === "solar" && (
                    <option value="day">{t("items.periodUnit.day")}</option>
                  )}
                  {item.calendar_mode === "solar" && (
                    <option value="week">{t("items.periodUnit.week")}</option>
                  )}
                  <option value="month">{t("items.periodUnit.month")}</option>
                  <option value="year">{t("items.periodUnit.year")}</option>
                </select>
              </div>
            </Field>

            <div
              className={cn(item.calendar_mode === "both" && "sm:row-span-2")}
            >
              <Field label={t("items.expiryDate")}>
                {item.calendar_mode === "both" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-8">
                        {t("items.calendarSolar")}
                      </span>
                      <input
                        type="date"
                        className={cn(INPUT, "flex-1")}
                        value={item.expiry_date}
                        onChange={(e) =>
                          setField("expiry_date", e.target.value)
                        }
                        required
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatLunarDate(item.expiry_date)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-8">
                        {t("items.calendarLunar")}
                      </span>
                      <input
                        type="date"
                        className={cn(INPUT, "flex-1")}
                        value={item.lunar_expiry_date ?? ""}
                        onChange={(e) =>
                          setField("lunar_expiry_date", e.target.value || null)
                        }
                      />
                      {item.lunar_expiry_date && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatLunarDate(item.lunar_expiry_date)}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      className={cn(INPUT, "flex-1")}
                      value={item.expiry_date}
                      onChange={(e) => setField("expiry_date", e.target.value)}
                      required
                    />
                    {item.calendar_mode !== "solar" && item.expiry_date && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatLunarDate(item.expiry_date)}
                      </span>
                    )}
                  </div>
                )}
              </Field>
            </div>

            <Field label={t("items.reminderBefore")}>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  className={cn(INPUT, "w-24")}
                  value={item.reminder_value}
                  onChange={(e) =>
                    setField("reminder_value", Number(e.target.value))
                  }
                />
                <select
                  className={SELECT}
                  value={item.reminder_unit}
                  onChange={(e) =>
                    setField("reminder_unit", e.target.value as any)
                  }
                >
                  <option value="day">{t("items.periodUnit.day")}</option>
                  <option value="hour">{t("items.periodUnit.hour")}</option>
                </select>
              </div>
            </Field>
          </div>

          {item.item_kind === "subscription" && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t("items.amount")}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={INPUT}
                  value={item.amount ?? ""}
                  onChange={(e) =>
                    setField(
                      "amount",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                />
              </Field>

              <Field label={t("items.currency")}>
                <select
                  className={SELECT}
                  value={item.currency}
                  onChange={(e) => setField("currency", e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="flex gap-6 flex-wrap">
            <Toggle
              checked={!!item.is_active}
              onChange={(v) => setField("is_active", v ? 1 : 0)}
              label={t("items.enableItem")}
            />
            <Toggle
              checked={!!item.auto_renew}
              onChange={(v) => setField("auto_renew", v ? 1 : 0)}
              label={t("items.autoRenew")}
            />
          </div>

          {/* Calendar mode selector + action buttons */}
          <div className="grid sm:grid-cols-2 gap-4 items-end">
            <Field label={t("items.calendarMode")}>
              <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                {(["solar", "lunar", "both"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      if (
                        (mode === "lunar" || mode === "both") &&
                        (item.period_unit === "day" ||
                          item.period_unit === "week")
                      ) {
                        setItem((prev) =>
                          prev
                            ? {
                                ...prev,
                                calendar_mode: mode,
                                period_unit: "month",
                              }
                            : prev,
                        );
                      } else {
                        setField("calendar_mode", mode);
                      }
                    }}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                      item.calendar_mode === mode
                        ? "bg-background shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(
                      `items.calendar${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
                    )}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleTestNotify}
                disabled={notifying}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {t("items.testNotify")}
              </button>
              <button
                type="button"
                onClick={handleRecalcExpiry}
                disabled={!item?.start_date}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
              >
                <Calculator className="w-4 h-4" />
                {t("items.recalcExpiry")}
              </button>
              {notifyMsg && (
                <span
                  className={cn(
                    "text-sm self-center",
                    notifyError ? "text-destructive" : "text-green-600",
                  )}
                >
                  {notifyMsg}
                </span>
              )}
            </div>
          </div>

          <Field label={t("items.notes")}>
            <textarea
              rows={3}
              className={cn(INPUT, "resize-none")}
              value={item.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </Field>

          <ChannelSelector selected={channels} onChange={setChannels} />

          <NotificationHoursSelector
            selected={notificationHours}
            onChange={setNotificationHours}
            hint={t("items.notificationHoursHint")}
          />

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? t("common.loading") : t("common.save")}
            </button>
            {saveMsg && (
              <span className="text-sm text-green-600">{saveMsg}</span>
            )}
          </div>
        </form>
      </section>

      {/* Renew / Reset */}
      {item.item_mode === "cycle" ? (
        <section className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-base">{t("items.renew")}</h2>
          <form onSubmit={handleRenew} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {item.item_kind === "subscription" && (
                <Field label={t("items.amount")}>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={INPUT}
                    value={renewAmount}
                    onChange={(e) => setRenewAmount(e.target.value)}
                  />
                </Field>
              )}

              <Field label={t("common.date")}>
                <input
                  type="date"
                  className={INPUT}
                  value={renewDate}
                  onChange={(e) => setRenewDate(e.target.value)}
                />
              </Field>

              <Field label={t("items.renewMultiplier")}>
                <input
                  type="number"
                  min={1}
                  className={INPUT}
                  value={renewMultiplier}
                  onChange={(e) => setRenewMultiplier(e.target.value)}
                />
              </Field>

              <Field label={t("common.note")}>
                <input
                  className={INPUT}
                  value={renewNote}
                  onChange={(e) => setRenewNote(e.target.value)}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={renewing}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {renewing ? t("common.loading") : t("items.renew")}
            </button>
          </form>
        </section>
      ) : (
        <section className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-base">{t("items.resetCycle")}</h2>
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t("items.amount")}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={INPUT}
                  value={renewAmount}
                  onChange={(e) => setRenewAmount(e.target.value)}
                />
              </Field>

              <Field label={t("common.date")}>
                <input
                  type="date"
                  className={INPUT}
                  value={renewDate}
                  onChange={(e) => setRenewDate(e.target.value)}
                />
              </Field>

              <Field label={t("common.note")}>
                <input
                  className={INPUT}
                  value={renewNote}
                  onChange={(e) => setRenewNote(e.target.value)}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={resetting}
              className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {resetting ? t("common.loading") : t("items.resetCycle")}
            </button>
          </form>
        </section>
      )}

      {/* Payment / Renewal history */}
      <section className="bg-card rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-base">{t("items.renewHistory")}</h2>

        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("dashboard.noData")}
          </p>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block rounded-lg border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    {[
                      t("common.date"),
                      t("items.amount"),
                      t("items.type"),
                      t("common.note"),
                      t("common.period"),
                      t("common.actions"),
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) =>
                    editingPayment?.id === p.id ? (
                      <tr key={p.id} className="bg-muted/20">
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            className={cn(INPUT, "py-1")}
                            value={editingPayment.date}
                            onChange={(e) =>
                              setEditingPayment({
                                ...editingPayment,
                                date: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className={cn(INPUT, "py-1 w-24")}
                            value={editingPayment.amount}
                            onChange={(e) =>
                              setEditingPayment({
                                ...editingPayment,
                                amount: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t(`items.paymentType.${p.type}`)}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={cn(INPUT, "py-1")}
                            value={editingPayment.note}
                            onChange={(e) =>
                              setEditingPayment({
                                ...editingPayment,
                                note: e.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                          {p.period_start && p.period_end
                            ? `${p.period_start} → ${p.period_end}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={handleSavePayment}
                              className="p-1 rounded hover:bg-accent text-green-600"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingPayment(null)}
                              className="p-1 rounded hover:bg-accent"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2">{p.date.slice(0, 10)}</td>
                        <td className="px-3 py-2 font-medium tabular-nums">
                          {p.currency} {p.amount.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t(`items.paymentType.${p.type}`)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {p.note || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                          {p.period_start && p.period_end
                            ? `${p.period_start} → ${p.period_end}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingPayment({
                                  id: p.id,
                                  date: p.date.slice(0, 10),
                                  amount: String(p.amount),
                                  note: p.note,
                                })
                              }
                              className="p-1 rounded hover:bg-accent"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePayment(p.id)}
                              className="p-1 rounded hover:bg-accent text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-2">
              {payments.map((p) =>
                editingPayment?.id === p.id ? (
                  <div
                    key={p.id}
                    className="rounded-lg border border-primary/30 p-3 text-sm space-y-2 bg-muted/20"
                  >
                    <div className="space-y-2">
                      <input
                        type="date"
                        className={cn(INPUT, "py-1.5 w-full")}
                        value={editingPayment.date}
                        onChange={(e) =>
                          setEditingPayment({
                            ...editingPayment,
                            date: e.target.value,
                          })
                        }
                      />
                      <input
                        type="number"
                        step="0.01"
                        className={cn(INPUT, "py-1.5 w-full")}
                        value={editingPayment.amount}
                        onChange={(e) =>
                          setEditingPayment({
                            ...editingPayment,
                            amount: e.target.value,
                          })
                        }
                        placeholder={t("items.amount")}
                      />
                      <input
                        className={cn(INPUT, "py-1.5 w-full")}
                        value={editingPayment.note}
                        onChange={(e) =>
                          setEditingPayment({
                            ...editingPayment,
                            note: e.target.value,
                          })
                        }
                        placeholder={t("common.note")}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSavePayment}
                        className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground"
                      >
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPayment(null)}
                        className="text-xs px-3 py-1.5 rounded bg-accent"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={p.id}
                    className="rounded-lg border p-3 text-sm space-y-1"
                  >
                    <div className="flex justify-between font-medium">
                      <span>{p.date.slice(0, 10)}</span>
                      <span className="tabular-nums">
                        {p.currency} {p.amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-xs">
                      <span>
                        {t(`items.paymentType.${p.type}`)}
                        {p.note ? ` · ${p.note}` : ""}
                      </span>
                      {p.period_start && p.period_end && (
                        <span>
                          {p.period_start} → {p.period_end}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setEditingPayment({
                            id: p.id,
                            date: p.date.slice(0, 10),
                            amount: String(p.amount),
                            note: p.note,
                          })
                        }
                        className="text-xs px-2 py-1 rounded bg-accent hover:bg-accent/70"
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePayment(p.id)}
                        className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </section>

      {/* Delete */}
      <section className="flex">
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          {t("common.delete")}
        </button>
      </section>

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message || ""}
        variant={confirm?.variant || "primary"}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirm?.onConfirm || (() => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

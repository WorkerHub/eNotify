import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ArrowLeft, Bell, ChevronDown, HelpCircle } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Item } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { formatLunarDate, solarToLunar, lunarToSolar } from "@/lib/lunar";
import { ChannelSelector } from "@/components/ChannelSelector";
import { NotificationHoursSelector } from "@/components/NotificationHoursSelector";
import { TagCombobox } from "@/components/TagCombobox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/states";
import { DueRing, DueCount } from "@/components/DueRing";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Portal } from "@/components/Portal";

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
  // Try with original isLeap flag first, then fall back to non-leap
  let solar = lunarToSolar(newYear, newMonth, lunar.day, lunar.isLeap);
  if (!solar) solar = lunarToSolar(newYear, newMonth, lunar.day, false);
  // If target month only has 29 days (day 30 doesn't exist), fall back to day 29
  if (!solar && lunar.day === 30) {
    solar = lunarToSolar(newYear, newMonth, 29, lunar.isLeap);
    if (!solar) solar = lunarToSolar(newYear, newMonth, 29, false);
  }
  if (!solar) return null;
  return `${solar.year}-${String(solar.month).padStart(2, "0")}-${String(solar.day).padStart(2, "0")}`;
}

interface FormData {
  name: string;
  item_kind: "regular" | "subscription";
  item_mode: "cycle" | "reset";
  category: string;
  start_date: string;
  period_value: string;
  period_unit: "day" | "week" | "month" | "year";
  reminder_value: string;
  reminder_unit: "day" | "hour";
  amount: string;
  currency: string;
  auto_renew: boolean;
  calendar_mode: "solar" | "lunar" | "both";
  notes: string;
  channels: string[];
  notification_hours: number[];
}

const DEFAULT: FormData = {
  name: "",
  item_kind: "regular",
  item_mode: "cycle",
  category: "",
  start_date: getTodayStr(),
  period_value: "1",
  period_unit: "month",
  reminder_value: "7",
  reminder_unit: "day",
  amount: "",
  currency: "CNY",
  auto_renew: true,
  calendar_mode: "solar",
  notes: "",
  channels: [],
  notification_hours: [],
};

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
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
  const ref = useRef<HTMLButtonElement>(null);
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
        <button
          type="button"
          aria-label={label}
          ref={ref}
          className="inline-flex ml-0.5"
          onMouseEnter={updatePos}
          onMouseLeave={() => setPos(null)}
        >
          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
          {pos && (
            <Portal>
              <div
                className="fixed px-3 py-2 rounded-lg text-xs bg-popover text-popover-foreground border shadow-3 pointer-events-none z-[100] w-80 whitespace-pre-wrap"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: "translate(-50%, calc(-100% - 8px))",
                }}
              >
                {tooltip}
              </div>
            </Portal>
          )}
        </button>
      </div>
      {children}
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow";
const SELECT = cn(INPUT, "cursor-pointer");

export function ItemNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState<FormData>({
    ...DEFAULT,
    currency: user?.base_currency || "CNY",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const isMobile = useIsMobile();
  const [openSections, setOpenSections] = useState({
    basic: true,
    cycle: true,
    reminder: true,
  });
  const toggleSection = (k: "basic" | "cycle" | "reminder") =>
    setOpenSections((p) => ({ ...p, [k]: !p[k] }));

  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const kindTooltipRef = useRef<HTMLButtonElement>(null);
  const [kindTooltipPos, setKindTooltipPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    api
      .get<{ categories: string[] }>("/items/tags")
      .then((r) => setTags(r.categories || []))
      .catch(() => {});
  }, []);

  const set = <K extends keyof FormData>(key: K, val: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const derivedExpiry = useMemo(() => {
    if (!form.start_date) return null;
    const pv = Number(form.period_value) || 1;
    const today = getTodayStr();

    if (form.calendar_mode === "both") {
      // Solar and lunar tracks advance independently from start_date
      let solarDate = addPeriod(form.start_date, pv, form.period_unit);
      while (solarDate < today) {
        solarDate = addPeriod(solarDate, pv, form.period_unit);
      }

      let lunarDate = addLunarPeriod(form.start_date, pv, form.period_unit);
      while (lunarDate && lunarDate < today) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, form.period_unit) ??
          addPeriod(lunarDate, pv, form.period_unit);
      }

      const stored =
        lunarDate && lunarDate <= solarDate ? lunarDate : solarDate;
      return { solar: solarDate, lunarDate, stored };
    }

    if (form.calendar_mode === "lunar") {
      let lunarDate =
        addLunarPeriod(form.start_date, pv, form.period_unit) ??
        addPeriod(form.start_date, pv, form.period_unit);
      let iter = 0;
      while (lunarDate < today && iter < 1000) {
        lunarDate =
          addLunarPeriod(lunarDate, pv, form.period_unit) ??
          addPeriod(lunarDate, pv, form.period_unit);
        iter++;
      }
      return {
        solar: lunarDate,
        lunarDate: null as string | null,
        stored: lunarDate,
      };
    }

    let solarDate = addPeriod(form.start_date, pv, form.period_unit);
    let iter = 0;
    while (solarDate < today && iter < 1000) {
      solarDate = addPeriod(solarDate, pv, form.period_unit);
      iter++;
    }
    return {
      solar: solarDate,
      lunarDate: null as string | null,
      stored: solarDate,
    };
  }, [
    form.start_date,
    form.period_value,
    form.period_unit,
    form.calendar_mode,
  ]);

  const buildPayload = () => ({
    ...form,
    expiry_date: derivedExpiry!.solar,
    lunar_expiry_date:
      form.calendar_mode === "both" ? derivedExpiry!.lunarDate : null,
    period_value: Number(form.period_value) || 1,
    reminder_value: Number(form.reminder_value) || 7,
    amount:
      form.item_kind === "subscription" && form.amount
        ? Number(form.amount)
        : null,
    start_date: form.start_date || null,
    auto_renew: form.auto_renew ? 1 : 0,
    calendar_mode: form.calendar_mode,
    channels: form.channels,
    notification_hours: form.notification_hours,
  });

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!form.start_date) return;
    if (!derivedExpiry) return;

    setSubmitting(true);
    setError("");
    try {
      await api.post("/items", buildPayload());
      navigate("/items");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndTest = () => {
    if (!form.name.trim() || !form.start_date || !derivedExpiry) return;
    setConfirm({
      message: t("items.testNotifyConfirm"),
      onConfirm: async () => {
        setConfirm(null);
        setSubmitting(true);
        setError("");
        try {
          const created = await api.post<Item>("/items", buildPayload());
          await api.post(`/items/${created.id}/test-notify`);
          navigate(`/items/${created.id}`);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const previewDays = derivedExpiry
    ? Math.ceil(
        (new Date(derivedExpiry.solar).getTime() -
          new Date(
            `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
          ).getTime()) /
          86400000,
      )
    : null;
  const previewPeriodDays = Math.max(
    1,
    Number(form.period_value || 1) *
      { day: 1, week: 7, month: 30, year: 365 }[form.period_unit],
  );

  const sectionHead = (key: "basic" | "cycle" | "reminder", label: string) =>
    isMobile ? (
      <button
        type="button"
        onClick={() => toggleSection(key)}
        aria-expanded={openSections[key]}
        className="flex w-full items-center justify-between py-1 text-title"
      >
        {label}
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-(--duration-standard)",
            openSections[key] && "rotate-180",
          )}
        />
      </button>
    ) : (
      <h2 className="text-title">{label}</h2>
    );

  const sectionVisible = (key: "basic" | "cycle" | "reminder") =>
    !isMobile || openSections[key];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/items")}
          className="p-1.5 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-heading">{t("items.add")}</h1>
      </div>

      {error && <ErrorState message={error} />}

      <div className="md:grid md:grid-cols-[1fr_300px] md:gap-8 md:items-start">
        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="space-y-5">
            {sectionHead("basic", t("detail.sectionBasic"))}
            <div
              className={cn("space-y-5", !sectionVisible("basic") && "hidden")}
            >
              {/* Kind selector */}
              <div className="flex items-center gap-2">
                <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() => set("item_kind", "regular")}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-body-sm font-medium transition-colors",
                      form.item_kind === "regular"
                        ? "bg-background shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t("items.kindRegular")}
                  </button>
                  <button
                    type="button"
                    onClick={() => set("item_kind", "subscription")}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-body-sm font-medium transition-colors",
                      form.item_kind === "subscription"
                        ? "bg-background shadow text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t("items.kindSubscription")}
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={t("items.mode.tooltip")}
                  ref={kindTooltipRef}
                  className="inline-flex"
                  onMouseEnter={() => {
                    if (!kindTooltipRef.current) return;
                    const rect = kindTooltipRef.current.getBoundingClientRect();
                    setKindTooltipPos({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setKindTooltipPos(null)}
                >
                  <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  {kindTooltipPos && (
                    <Portal>
                      <div
                        className="fixed px-3 py-2 rounded-lg text-xs bg-popover text-popover-foreground border shadow-3 pointer-events-none z-[100] w-80 whitespace-normal"
                        style={{
                          left: kindTooltipPos.x,
                          top: kindTooltipPos.y,
                          transform: "translate(-50%, calc(-100% - 8px))",
                        }}
                      >
                        <span className="font-medium">
                          {t("items.kindRegular")}：
                        </span>
                        {t("items.kindRegularTooltip")}
                        <br />
                        <span className="font-medium">
                          {t("items.kindSubscription")}：
                        </span>
                        {t("items.kindSubscriptionTooltip")}
                      </div>
                    </Portal>
                  )}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t("items.name")} required>
                  <input
                    className={INPUT}
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    required
                  />
                </Field>

                <FieldWithTooltip
                  label={t("items.mode.label")}
                  tooltip={t("items.mode.tooltip")}
                >
                  <select
                    className={SELECT}
                    value={form.item_mode}
                    onChange={(e) =>
                      set("item_mode", e.target.value as FormData["item_mode"])
                    }
                  >
                    <option value="cycle">{t("items.mode.cycle")}</option>
                    <option value="reset">{t("items.mode.reset")}</option>
                  </select>
                </FieldWithTooltip>

                <Field label={t("items.category")}>
                  <TagCombobox
                    value={form.category}
                    onChange={(v) => set("category", v)}
                    options={tags}
                  />
                </Field>

                <Field label={t("items.startDate")} required>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      className={cn(INPUT, "flex-1")}
                      value={form.start_date}
                      onChange={(e) => set("start_date", e.target.value)}
                      required
                    />
                    {form.calendar_mode !== "solar" && form.start_date && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatLunarDate(form.start_date)}
                      </span>
                    )}
                  </div>
                </Field>

                <Field label={t("items.period")} required>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      className={cn(INPUT, "w-24")}
                      value={form.period_value}
                      onChange={(e) => set("period_value", e.target.value)}
                      required
                    />
                    <select
                      className={SELECT}
                      value={form.period_unit}
                      onChange={(e) =>
                        set(
                          "period_unit",
                          e.target.value as FormData["period_unit"],
                        )
                      }
                    >
                      {form.calendar_mode === "solar" && (
                        <option value="day">{t("items.periodUnit.day")}</option>
                      )}
                      {form.calendar_mode === "solar" && (
                        <option value="week">
                          {t("items.periodUnit.week")}
                        </option>
                      )}
                      <option value="month">
                        {t("items.periodUnit.month")}
                      </option>
                      <option value="year">{t("items.periodUnit.year")}</option>
                    </select>
                  </div>
                </Field>

                <div
                  className={cn(
                    form.calendar_mode === "both" && "sm:row-span-2",
                  )}
                >
                  <Field label={t("items.expiryDate")} required>
                    {derivedExpiry ? (
                      form.calendar_mode === "both" ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground shrink-0 w-8">
                              {t("items.calendarSolar")}
                            </span>
                            <span
                              className={cn(
                                INPUT,
                                "flex-1 bg-muted/50 text-muted-foreground cursor-not-allowed select-none",
                              )}
                            >
                              {derivedExpiry.solar}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatLunarDate(derivedExpiry.solar)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground shrink-0 w-8">
                              {t("items.calendarLunar")}
                            </span>
                            <span
                              className={cn(
                                INPUT,
                                "flex-1 bg-muted/50 text-muted-foreground cursor-not-allowed select-none",
                              )}
                            >
                              {derivedExpiry.lunarDate ?? "—"}
                            </span>
                            {derivedExpiry.lunarDate && (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatLunarDate(derivedExpiry.lunarDate)}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              INPUT,
                              "flex-1 bg-muted/50 text-muted-foreground cursor-not-allowed select-none",
                            )}
                          >
                            {derivedExpiry.solar}
                          </span>
                          {form.calendar_mode === "lunar" && (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatLunarDate(derivedExpiry.solar)}
                            </span>
                          )}
                        </div>
                      )
                    ) : (
                      <div
                        className={cn(
                          INPUT,
                          "bg-muted/50 text-muted-foreground",
                        )}
                      >
                        —
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
                      value={form.reminder_value}
                      onChange={(e) => set("reminder_value", e.target.value)}
                    />
                    <select
                      className={SELECT}
                      value={form.reminder_unit}
                      onChange={(e) =>
                        set(
                          "reminder_unit",
                          e.target.value as FormData["reminder_unit"],
                        )
                      }
                    >
                      <option value="day">{t("items.periodUnit.day")}</option>
                      <option value="hour">{t("items.periodUnit.hour")}</option>
                    </select>
                  </div>
                </Field>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {sectionHead("cycle", t("detail.sectionCycle"))}
            <div
              className={cn("space-y-5", !sectionVisible("cycle") && "hidden")}
            >
              {/* Amount + currency */}
              {form.item_kind === "subscription" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label={t("items.amount")}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={INPUT}
                      value={form.amount}
                      onChange={(e) => set("amount", e.target.value)}
                    />
                  </Field>

                  <Field label={t("items.currency")}>
                    <select
                      className={SELECT}
                      value={form.currency}
                      onChange={(e) => set("currency", e.target.value)}
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

              {/* Toggles */}
              <div className="flex gap-6 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.auto_renew}
                    onClick={() => set("auto_renew", !form.auto_renew)}
                    className={cn(
                      "relative w-10 h-6 rounded-full transition-colors",
                      form.auto_renew ? "bg-primary" : "bg-input",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-[calc(50%-8px)] left-1 w-4 h-4 rounded-full bg-white shadow transition-transform",
                        form.auto_renew && "translate-x-4",
                      )}
                    />
                  </button>
                  <span className="text-sm font-medium">
                    {t("items.autoRenew")}
                  </span>
                </label>
              </div>

              {/* Calendar mode selector + test button */}
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
                            (form.period_unit === "day" ||
                              form.period_unit === "week")
                          ) {
                            setForm((prev) => ({
                              ...prev,
                              calendar_mode: mode,
                              period_unit: "month",
                            }));
                          } else {
                            set("calendar_mode", mode);
                          }
                        }}
                        className={cn(
                          "px-4 py-1.5 rounded-md text-body-sm font-medium transition-colors",
                          form.calendar_mode === mode
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
                <div>
                  <button
                    type="button"
                    onClick={handleSaveAndTest}
                    disabled={
                      submitting ||
                      !form.name.trim() ||
                      !form.start_date ||
                      !derivedExpiry
                    }
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border text-body-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    {submitting ? t("common.loading") : t("items.testNotify")}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {sectionHead("reminder", t("detail.sectionReminder"))}
            <div
              className={cn(
                "space-y-5",
                !sectionVisible("reminder") && "hidden",
              )}
            >
              {/* Notes */}
              <Field label={t("items.notes")}>
                <textarea
                  rows={3}
                  className={cn(INPUT, "resize-none")}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </Field>

              {/* Channel selector */}
              <ChannelSelector
                selected={form.channels}
                onChange={(channels) => set("channels", channels)}
              />

              <NotificationHoursSelector
                selected={form.notification_hours}
                onChange={(hours) => set("notification_hours", hours)}
                hint={t("items.notificationHoursHint")}
              />
            </div>
          </section>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-md text-body-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? t("common.loading") : t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/items")}
              className="px-6 py-2 rounded-md text-body-sm font-medium border hover:bg-accent transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>

        {/* Due preview summary card — desktop right rail (§5 items/new) */}
        <aside className="mt-8 md:mt-0 md:sticky md:top-6">
          <div className="rounded-lg border bg-card p-4 shadow-1 md:p-6 space-y-3">
            <h2 className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {t("detail.summary")}
            </h2>
            {derivedExpiry && previewDays != null ? (
              <div className="flex items-center gap-4">
                <DueRing
                  days={previewDays}
                  progress={Math.max(
                    0,
                    Math.min(1, previewDays / previewPeriodDays),
                  )}
                  size={48}
                  strokeWidth={4}
                />
                <div className="flex flex-col gap-1">
                  <DueCount
                    days={previewDays}
                    unit={t("detail.daysUnit")}
                    size="md"
                  />
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {derivedExpiry.solar}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-body-sm text-muted-foreground">—</p>
            )}
            {form.name.trim() && (
              <p className="text-body-strong truncate">{form.name}</p>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message || ""}
        variant="primary"
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirm?.onConfirm || (() => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

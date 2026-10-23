import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  CreditCard,
  Bell,
  RotateCcw,
  HelpCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  RefreshCw,
  Pencil,
  Search,
  ChevronDown,
  Ellipsis,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Item } from "@/types";
import { formatLunarDate } from "@/lib/lunar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Portal } from "@/components/Portal";
import { DueRing, DueCount, dueTierBadgeClass } from "@/components/DueRing";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";

type StatusKey = "active" | "expiringSoon" | "expired" | "inactive";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getEffectiveExpiry(item: Item): string {
  if (item.calendar_mode === "both" && item.lunar_expiry_date) {
    return item.lunar_expiry_date <= item.expiry_date
      ? item.lunar_expiry_date
      : item.expiry_date;
  }
  return item.expiry_date;
}

function getStatus(item: Item): StatusKey {
  if (!item.is_active) return "inactive";
  const today = localToday();
  const expiry = getEffectiveExpiry(item);
  if (expiry < today) return "expired";
  const diff = Math.ceil(
    (new Date(expiry).getTime() - new Date(today).getTime()) / 86400000,
  );
  if (diff <= 7) return "expiringSoon";
  return "active";
}

function getDaysRemaining(item: Item): number {
  const today = localToday();
  const expiry = getEffectiveExpiry(item);
  return Math.ceil(
    (new Date(expiry).getTime() - new Date(today).getTime()) / 86400000,
  );
}

function getPeriodDays(item: Item): number {
  const unit = { day: 1, week: 7, month: 30, year: 365 }[item.period_unit];
  return Math.max(1, item.period_value * unit);
}

const STATUS_STYLES: Record<StatusKey, string> = {
  active: "bg-success/10 text-success",
  expiringSoon: "bg-warning/10 text-warning",
  expired: "bg-destructive/10 text-destructive",
  inactive: "bg-muted text-muted-foreground",
};

/** Countdown anchor: remaining-progress ring + tabular day count in the due gradient (§3.1). */
function DueMark({ days, item }: { days: number; item: Item }) {
  const { t } = useTranslation();
  const progress = Math.max(0, Math.min(1, days / getPeriodDays(item)));
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={t("items.daysRemaining")}
    >
      <DueRing days={days} progress={progress} size={20} strokeWidth={2.5} />
      <span
        className={cn(
          "px-1.5 py-0.5 rounded-xs text-caption font-medium tabular-nums",
          dueTierBadgeClass(days),
        )}
      >
        {days < 0
          ? t("items.overdueShort", { count: Math.abs(days) })
          : t("items.daysShort", { count: days })}
      </span>
    </span>
  );
}

function HelpIcon({ tooltip }: { tooltip: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const updatePos = () => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  return (
    <button
      type="button"
      aria-label="Help"
      ref={ref}
      className="inline-flex ml-0.5"
      onMouseEnter={updatePos}
      onMouseLeave={() => setPos(null)}
    >
      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
      {pos && (
        <Portal>
          <div
            className="fixed px-3 py-2 rounded-lg text-xs bg-popover text-popover-foreground border shadow-lg pointer-events-none z-[100] w-80 whitespace-pre-wrap"
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
  );
}

function FilterIcon({
  options,
  selected,
  onChange,
  allLabel,
}: {
  options: string[];
  selected: string;
  onChange: (v: string) => void;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.bottom + 4 });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  if (options.length === 0) return null;

  return (
    <span className="inline-flex">
      <button
        type="button"
        ref={ref}
        className="inline-flex"
        onClick={toggle}
        aria-label="Filter"
      >
        <Filter
          className={cn(
            "w-3.5 h-3.5 cursor-pointer",
            selected ? "text-primary" : "text-muted-foreground opacity-40",
          )}
        />
      </button>
      {open && pos && (
        <Portal>
          <button
            type="button"
            aria-label="Close filter"
            className="fixed inset-0 z-[100]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bg-popover border rounded-lg shadow-lg p-2 z-[101] min-w-[140px]"
            style={{ left: pos.x, top: pos.y }}
          >
            <label className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-accent rounded">
              <input
                type="radio"
                checked={selected === ""}
                onChange={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="accent-primary"
              />
              {allLabel}
            </label>
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-accent rounded"
              >
                <input
                  type="radio"
                  checked={selected === opt}
                  onChange={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className="accent-primary"
                />
                {opt}
              </label>
            ))}
          </div>
        </Portal>
      )}
    </span>
  );
}

export function ItemListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);

  // Confirm dialog
  const [confirm, setConfirm] = useState<{
    message: string;
    variant: "danger" | "primary";
    onConfirm: () => void;
  } | null>(null);

  // Sort & filter
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusKey | "">("");
  const [openDropdown, setOpenDropdown] = useState<
    "category" | "status" | null
  >(null);
  const [moreId, setMoreId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Item[]>("/items");
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleToggle = async (item: Item) => {
    try {
      const res = await api.post<{ success: boolean; is_active: number }>(
        `/items/${item.id}/toggle-status`,
      );
      setItems((prev) =>
        prev.map((s) =>
          s.id === item.id ? { ...s, is_active: res.is_active } : s,
        ),
      );
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleTestNotify = (item: Item) => {
    setConfirm({
      message: t("items.testNotifyConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setTestingId(item.id);
        try {
          await api.post(`/items/${item.id}/test-notify`);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setTestingId(null);
        }
      },
    });
  };

  const handleDelete = (item: Item) => {
    setConfirm({
      message: t("common.confirmDelete", { name: item.name }),
      variant: "danger",
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.delete(`/items/${item.id}`);
          setItems((prev) => prev.filter((s) => s.id !== item.id));
        } catch (e: any) {
          setError(e.message);
        }
      },
    });
  };

  const handleReset = (item: Item) => {
    setConfirm({
      message: t("items.resetConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setResettingId(item.id);
        try {
          const res = await api.post<{ new_expiry_date: string }>(
            `/items/${item.id}/reset`,
          );
          setItems((prev) =>
            prev.map((s) =>
              s.id === item.id
                ? {
                    ...s,
                    expiry_date: res.new_expiry_date,
                    last_payment_date: new Date().toISOString(),
                  }
                : s,
            ),
          );
        } catch (e: any) {
          setError(e.message);
        } finally {
          setResettingId(null);
        }
      },
    });
  };

  const handleRenew = (item: Item) => {
    setConfirm({
      message: t("items.renewConfirm"),
      variant: "primary",
      onConfirm: async () => {
        setConfirm(null);
        setRenewingId(item.id);
        try {
          const res = await api.post<{ new_expiry_date: string }>(
            `/items/${item.id}/renew`,
            {
              multiplier: 1,
            },
          );
          setItems((prev) =>
            prev.map((s) =>
              s.id === item.id
                ? {
                    ...s,
                    expiry_date: res.new_expiry_date,
                    last_payment_date: new Date().toISOString(),
                  }
                : s,
            ),
          );
        } catch (e: any) {
          setError(e.message);
        } finally {
          setRenewingId(null);
        }
      },
    });
  };

  // Derived filter options
  const categoryOptions = [
    ...new Set(items.map((i) => i.category).filter(Boolean)),
  ];

  // Filtered & sorted items
  const displayItems = items
    .filter((i) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!i.name.toLowerCase().includes(q)) return false;
      }
      if (filterCategory && i.category !== filterCategory) return false;
      if (filterStatus && getStatus(i) !== filterStatus) return false;
      return true;
    })
    .sort((a, b) => {
      if (!sortOrder) return 0;
      const da = new Date(getEffectiveExpiry(a)).getTime();
      const db = new Date(getEffectiveExpiry(b)).getTime();
      return sortOrder === "asc" ? da - db : db - da;
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-heading">{t("items.title")}</h1>
        <button
          type="button"
          onClick={() => navigate("/items/new")}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-body-sm font-medium shadow-1 hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t("items.add")}
        </button>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={loadItems}
          retryLabel={t("common.retry")}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => `skeleton-${i + 1}`).map(
            (skeletonKey) => (
              <div
                key={skeletonKey}
                className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
              >
                <Skeleton className="h-5 w-5 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-10" />
              </div>
            ),
          )}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-6 h-6" />}
          title={t("items.emptyTitle")}
          description={t("items.emptyDesc")}
          action={
            <button
              type="button"
              onClick={() => navigate("/items/new")}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-body-sm font-medium shadow-1 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("items.add")}
            </button>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[23%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    {t("items.name")}
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap relative">
                    <span className="inline-flex items-center gap-1">
                      {t("items.category")}
                      <FilterIcon
                        options={categoryOptions}
                        selected={filterCategory}
                        onChange={setFilterCategory}
                        allLabel={t("items.filterAll")}
                      />
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    {t("items.mode.label")}{" "}
                    <HelpIcon tooltip={t("items.mode.tooltip")} />
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 cursor-pointer select-none"
                      onClick={() =>
                        setSortOrder((prev) =>
                          prev === "asc"
                            ? "desc"
                            : prev === "desc"
                              ? null
                              : "asc",
                        )
                      }
                    >
                      {t("items.expiryDate")}
                      {sortOrder === "asc" ? (
                        <ArrowUp className="w-3.5 h-3.5" />
                      ) : sortOrder === "desc" ? (
                        <ArrowDown className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                      )}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    {t("common.status")}
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    {t("items.reminder")}
                  </th>
                  <th className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayItems.map((item) => {
                  const status = getStatus(item);
                  const days = getDaysRemaining(item);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2 overflow-hidden">
                        <div className="font-medium truncate">{item.name}</div>
                        {item.notes && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {item.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground overflow-hidden truncate">
                        {item.category || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        <div>
                          {item.item_mode === "reset"
                            ? t("items.mode.reset")
                            : t("items.mode.cycle")}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {item.item_mode === "reset" ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          {item.period_value}
                          {t(`items.periodUnit.${item.period_unit}`)}
                        </div>
                      </td>
                      <td className="px-4 py-2 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span>{getEffectiveExpiry(item)}</span>
                          <DueMark days={days} item={item} />
                        </div>
                        {item.calendar_mode === "both" &&
                        item.lunar_expiry_date &&
                        item.lunar_expiry_date !== item.expiry_date ? (
                          <>
                            <span className="text-xs text-muted-foreground block truncate">
                              {t("items.calendarSolar")}：{item.expiry_date}{" "}
                              {formatLunarDate(item.expiry_date)}
                            </span>
                            <span className="text-xs text-muted-foreground block truncate">
                              {t("items.calendarLunar")}：
                              {item.lunar_expiry_date}{" "}
                              {formatLunarDate(item.lunar_expiry_date)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground block truncate">
                            {formatLunarDate(getEffectiveExpiry(item))}
                          </span>
                        )}
                        {item.start_date && (
                          <span className="text-xs text-muted-foreground block truncate">
                            {t("items.startDate")}：{item.start_date}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            STATUS_STYLES[status],
                          )}
                        >
                          {t(`items.status.${status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        <div>
                          {item.reminder_unit === "hour"
                            ? t("items.reminderHours", {
                                value: item.reminder_value,
                              })
                            : t("items.reminderDays", {
                                value: item.reminder_value,
                              })}
                        </div>
                        {days > 0 && item.reminder_unit !== "hour" && (
                          <div className="text-xs mt-0.5">
                            {days > item.reminder_value
                              ? t("items.nextReminderIn", {
                                  value: days - item.reminder_value,
                                })
                              : t("items.nextReminderActive")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/items/${item.id}`)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={t("common.edit")}
                            aria-label={t("common.edit")}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggle(item)}
                            className="p-1.5 rounded hover:bg-accent transition-colors"
                            title={
                              item.is_active
                                ? t("admin.deactivate")
                                : t("admin.activate")
                            }
                            aria-label={
                              item.is_active
                                ? t("admin.deactivate")
                                : t("admin.activate")
                            }
                          >
                            {item.is_active ? (
                              <ToggleRight className="w-4 h-4 text-green-500" />
                            ) : (
                              <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTestNotify(item)}
                            disabled={testingId === item.id}
                            className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                            title={t("items.testNotify")}
                            aria-label={t("items.testNotify")}
                          >
                            <Bell className="w-4 h-4" />
                          </button>
                          {item.item_mode === "reset" ? (
                            <button
                              type="button"
                              onClick={() => handleReset(item)}
                              disabled={resettingId === item.id}
                              className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                              title={t("items.resetCycle")}
                              aria-label={t("items.resetCycle")}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRenew(item)}
                              disabled={renewingId === item.id}
                              className="p-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
                              title={t("items.renew")}
                              aria-label={t("items.renew")}
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-destructive"
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile search & filter toolbar */}
          <div className="md:hidden space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("items.searchPlaceholder")}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="relative flex gap-2">
              {/* Category dropdown trigger */}
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(
                    openDropdown === "category" ? null : "category",
                  )
                }
                className={cn(
                  "shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1",
                  filterCategory || openDropdown === "category"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted/30 text-muted-foreground",
                )}
              >
                {filterCategory || t("items.category")}
                <ChevronDown
                  className={cn(
                    "w-3 h-3 transition-transform",
                    openDropdown === "category" && "rotate-180",
                  )}
                />
              </button>
              {/* Status dropdown trigger */}
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown(openDropdown === "status" ? null : "status")
                }
                className={cn(
                  "shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1",
                  filterStatus || openDropdown === "status"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted/30 text-muted-foreground",
                )}
              >
                {filterStatus
                  ? t(`items.status.${filterStatus}`)
                  : t("common.status")}
                <ChevronDown
                  className={cn(
                    "w-3 h-3 transition-transform",
                    openDropdown === "status" && "rotate-180",
                  )}
                />
              </button>
              {/* Sort chip */}
              <button
                type="button"
                onClick={() =>
                  setSortOrder((prev) =>
                    prev === "asc" ? "desc" : prev === "desc" ? null : "asc",
                  )
                }
                className={cn(
                  "shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1",
                  sortOrder
                    ? "bg-primary/10 text-primary"
                    : "bg-muted/30 text-muted-foreground",
                )}
              >
                {sortOrder === "asc" ? (
                  <ArrowUp className="w-3 h-3" />
                ) : sortOrder === "desc" ? (
                  <ArrowDown className="w-3 h-3" />
                ) : (
                  <ArrowUpDown className="w-3 h-3" />
                )}
                {t("items.sortExpiry")}
              </button>
              {/* Dropdown panel */}
              {openDropdown && (
                <button
                  type="button"
                  aria-label="Close dropdown"
                  className="fixed inset-0 z-10"
                  onClick={() => setOpenDropdown(null)}
                />
              )}
              {openDropdown === "category" && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 flex flex-wrap gap-2 p-2 rounded-lg border bg-card shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterCategory("");
                      setOpenDropdown(null);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      !filterCategory
                        ? "bg-primary/10 text-primary"
                        : "bg-muted/30 text-muted-foreground",
                    )}
                  >
                    {t("items.filterAll")}
                  </button>
                  {categoryOptions.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      onClick={() => {
                        setFilterCategory(cat);
                        setOpenDropdown(null);
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                        filterCategory === cat
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/30 text-muted-foreground",
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
              {openDropdown === "status" && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 flex flex-wrap gap-2 p-2 rounded-lg border bg-card shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatus("");
                      setOpenDropdown(null);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      !filterStatus
                        ? "bg-primary/10 text-primary"
                        : "bg-muted/30 text-muted-foreground",
                    )}
                  >
                    {t("items.filterAll")}
                  </button>
                  {(
                    [
                      "active",
                      "expiringSoon",
                      "expired",
                      "inactive",
                    ] as StatusKey[]
                  ).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => {
                        setFilterStatus(s);
                        setOpenDropdown(null);
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                        filterStatus === s
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/30 text-muted-foreground",
                      )}
                    >
                      {t(`items.status.${s}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {displayItems.map((item) => {
              const status = getStatus(item);
              const days = getDaysRemaining(item);
              return (
                <div
                  key={item.id}
                  className="bg-card rounded-xl border p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-body-strong truncate">{item.name}</p>
                        <DueCount
                          days={days}
                          unit={t("dashboard.daysUnit")}
                          size="sm"
                          className="shrink-0"
                        />
                      </div>
                      {item.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.notes}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted flex items-center gap-1">
                          {item.item_mode === "reset"
                            ? t("items.mode.reset")
                            : t("items.mode.cycle")}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          {item.item_mode === "reset" ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          {item.period_value}
                          {t(`items.periodUnit.${item.period_unit}`)}
                        </span>
                        {item.category && (
                          <span className="text-xs text-muted-foreground">
                            {item.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-xs font-medium shrink-0",
                        STATUS_STYLES[status],
                      )}
                    >
                      {t(`items.status.${status}`)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-start gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {getEffectiveExpiry(item)}
                          </span>
                          <DueMark days={days} item={item} />
                        </div>
                        {item.calendar_mode === "both" &&
                        item.lunar_expiry_date &&
                        item.lunar_expiry_date !== item.expiry_date ? (
                          <>
                            <span className="text-xs text-muted-foreground block">
                              {t("items.calendarSolar")}：{item.expiry_date}{" "}
                              {formatLunarDate(item.expiry_date)}
                            </span>
                            <span className="text-xs text-muted-foreground block">
                              {t("items.calendarLunar")}：
                              {item.lunar_expiry_date}{" "}
                              {formatLunarDate(item.lunar_expiry_date)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground block">
                            {formatLunarDate(getEffectiveExpiry(item))}
                          </span>
                        )}
                        {item.start_date && (
                          <span className="text-xs text-muted-foreground block">
                            {t("items.startDate")}：{item.start_date}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <div>
                        {item.reminder_unit === "hour"
                          ? t("items.reminderHours", {
                              value: item.reminder_value,
                            })
                          : t("items.reminderDays", {
                              value: item.reminder_value,
                            })}
                      </div>
                      {days > 0 && item.reminder_unit !== "hour" && (
                        <div>
                          {days > item.reminder_value
                            ? t("items.nextReminderIn", {
                                value: days - item.reminder_value,
                              })
                            : t("items.nextReminderActive")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t">
                    <button
                      type="button"
                      onClick={() => navigate(`/items/${item.id}`)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent hover:bg-accent/70 text-body-sm transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t("common.edit")}
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label={t("common.more")}
                        aria-expanded={moreId === item.id}
                        onClick={() =>
                          setMoreId(moreId === item.id ? null : item.id)
                        }
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent hover:bg-accent/70 text-body-sm transition-colors"
                      >
                        <Ellipsis className="w-4 h-4" />
                        {t("common.more")}
                      </button>
                      {moreId === item.id && (
                        <>
                          <button
                            type="button"
                            aria-label="Close menu"
                            className="fixed inset-0 z-40"
                            onClick={() => setMoreId(null)}
                          />
                          <div className="absolute right-0 bottom-full mb-1 z-50 w-40 rounded-lg border bg-popover py-1 shadow-3 text-body-sm">
                            <button
                              type="button"
                              onClick={() => {
                                setMoreId(null);
                                handleToggle(item);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-left"
                            >
                              {item.is_active ? (
                                <ToggleRight className="w-4 h-4 text-success" />
                              ) : (
                                <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                              )}
                              {item.is_active
                                ? t("admin.deactivate")
                                : t("admin.activate")}
                            </button>
                            <button
                              type="button"
                              disabled={testingId === item.id}
                              onClick={() => {
                                setMoreId(null);
                                handleTestNotify(item);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-left disabled:opacity-50"
                            >
                              <Bell className="w-4 h-4" />
                              {t("items.testNotify")}
                            </button>
                            {item.item_mode === "reset" ? (
                              <button
                                type="button"
                                disabled={resettingId === item.id}
                                onClick={() => {
                                  setMoreId(null);
                                  handleReset(item);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-left disabled:opacity-50"
                              >
                                <RotateCcw className="w-4 h-4" />
                                {t("items.resetCycle")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={renewingId === item.id}
                                onClick={() => {
                                  setMoreId(null);
                                  handleRenew(item);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-left disabled:opacity-50"
                              >
                                <RefreshCw className="w-4 h-4" />
                                {t("items.renew")}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMoreId(null);
                                handleDelete(item);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-destructive hover:bg-destructive/10 text-left"
                            >
                              <Trash2 className="w-4 h-4" />
                              {t("common.delete")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

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

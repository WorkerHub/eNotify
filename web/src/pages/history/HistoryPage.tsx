import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, History, X, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getChannelLabel } from "@/lib/channels";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cn } from "@/lib/utils";
import type { NotificationHistory } from "@/types";

type StatusFilter = "all" | "true" | "false";

const SOURCE_LABEL_KEYS: Record<string, string> = {
  item: "history.sourceItem",
  api: "history.sourceApi",
  test: "history.sourceTest",
};

function SourceBadge({ source }: { source: string | null }) {
  const { t } = useTranslation();
  const labelKey = source ? SOURCE_LABEL_KEYS[source] : undefined;
  if (!labelKey) return null;
  return (
    <span className="shrink-0 rounded-xs border border-border px-1.5 py-0.5 text-caption text-muted-foreground">
      {t(labelKey)}
    </span>
  );
}

interface GroupedHistory {
  id: string;
  title: string;
  body: string | null;
  item_name?: string;
  trigger_source: string | null;
  channels: { channel: string; success: boolean; error: string | null }[];
  created_at: string;
  allSuccess: boolean;
}

function groupHistory(records: NotificationHistory[]): GroupedHistory[] {
  const groups: GroupedHistory[] = [];
  for (const r of records) {
    const last = groups[groups.length - 1];
    // Merge if same item + title + within 2 minutes
    if (
      last &&
      last.item_name === r.item_name &&
      last.title === r.title &&
      Math.abs(
        new Date(r.created_at).getTime() - new Date(last.created_at).getTime(),
      ) < 120_000
    ) {
      last.channels.push({
        channel: r.channel,
        success: !!r.success,
        error: r.error,
      });
      if (!last.trigger_source && r.trigger_source) {
        last.trigger_source = r.trigger_source;
      }
      if (!r.success) last.allSuccess = false;
    } else {
      groups.push({
        id: r.id,
        title: r.title,
        body: r.body,
        item_name: r.item_name,
        trigger_source: r.trigger_source,
        channels: [
          { channel: r.channel, success: !!r.success, error: r.error },
        ],
        created_at: r.created_at,
        allSuccess: !!r.success,
      });
    }
  }
  return groups;
}

/** Group entries by calendar day for the timeline view (§5 history). */
function groupByDay(groups: GroupedHistory[]): [string, GroupedHistory[]][] {
  const days = new Map<string, GroupedHistory[]>();
  for (const g of groups) {
    const key = new Date(g.created_at).toLocaleDateString();
    const arr = days.get(key) ?? [];
    arr.push(g);
    days.set(key, arr);
  }
  return [...days.entries()];
}

export function HistoryPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state lives in the URL so a refresh (or a shared link) keeps it.
  const rawSuccess = searchParams.get("success");
  const status: StatusFilter =
    rawSuccess === "true" || rawSuccess === "false" ? rawSuccess : "all";
  // `all` is the Select's sentinel, never a real channel id; treat a hand-typed
  // `?channel=all` as "no channel filter" instead of querying a channel named all.
  const rawChannel = searchParams.get("channel");
  const channel = rawChannel && rawChannel !== "all" ? rawChannel : "";
  const hasFilters = !!channel || status !== "all";

  const [history, setHistory] = useState<NotificationHistory[]>([]);
  const [channelOptions, setChannelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GroupedHistory | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const requestIdRef = useRef(0);
  const seededOptionsRef = useRef(false);
  const detailTrapRef = useFocusTrap<HTMLDivElement>(!!selected, () =>
    setSelected(null),
  );

  const mergeChannelOptions = useCallback((records: NotificationHistory[]) => {
    setChannelOptions((prev) =>
      Array.from(new Set([...prev, ...records.map((r) => r.channel)])).sort(),
    );
  }, []);

  const fetchHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setFetching(true);
    try {
      const query = new URLSearchParams({ limit: "200" });
      if (channel) query.set("channel", channel);
      if (status !== "all") query.set("success", status);
      const data = await api.get<NotificationHistory[]>(
        `/me/notification-history?${query.toString()}`,
      );
      if (requestId !== requestIdRef.current) return;
      setHistory(data);
      mergeChannelOptions(data);
      setError("");
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e.message || t("common.error"));
    } finally {
      if (requestId === requestIdRef.current) {
        setFetching(false);
        setLoading(false);
      }
    }
  }, [channel, status, t, mergeChannelOptions]);

  useEffect(() => {
    // First load only: when the URL already carries a filter, the list request
    // returns just the matching channels. Fetch the unfiltered set once so the
    // channel dropdown can still offer every channel that appears in history.
    if (!seededOptionsRef.current) {
      seededOptionsRef.current = true;
      if (hasFilters) {
        api
          .get<NotificationHistory[]>("/me/notification-history?limit=200")
          .then(mergeChannelOptions)
          .catch(() => {
            /* the candidate list is best-effort; the list request owns errors */
          });
      }
    }
    fetchHistory();
  }, [fetchHistory, hasFilters, mergeChannelOptions]);

  const setFilters = (next: { channel?: string; status?: StatusFilter }) => {
    const nextChannel = next.channel ?? channel;
    const nextStatus = next.status ?? status;
    const params = new URLSearchParams(searchParams);
    if (nextChannel) params.set("channel", nextChannel);
    else params.delete("channel");
    if (nextStatus !== "all") params.set("success", nextStatus);
    else params.delete("success");
    setSearchParams(params, { replace: true });
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("channel");
    params.delete("success");
    setSearchParams(params, { replace: true });
  };

  const channelLabel = (id: string) =>
    t(`channels.${id}`, { defaultValue: getChannelLabel(id) });

  const grouped = groupHistory(history);
  const groupedByDay = groupByDay(grouped);
  const selectableChannels = Array.from(
    new Set([...channelOptions, channel].filter(Boolean)),
  ).sort((a, b) => channelLabel(a).localeCompare(channelLabel(b)));

  const handleClear = (e: React.MouseEvent, g: GroupedHistory) => {
    e.stopPropagation();
    setConfirm({
      message: t("common.confirmDelete", { name: g.title }),
      onConfirm: async () => {
        setConfirm(null);
        const groupRecords = history.filter((r) => {
          if (r.item_name !== g.item_name || r.title !== g.title) return false;
          const timeDiff = Math.abs(
            new Date(r.created_at).getTime() - new Date(g.created_at).getTime(),
          );
          return timeDiff < 120_000;
        });
        const deletedIds = new Set<string>();
        for (const r of groupRecords) {
          try {
            await api.delete(`/me/notification-history/${r.id}`);
            deletedIds.add(r.id);
          } catch {
            /* keep failed records visible */
          }
        }
        setHistory((prev) => prev.filter((r) => !deletedIds.has(r.id)));
      },
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-heading">{t("history.title")}</h1>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
          <span className="text-caption font-medium text-muted-foreground md:text-body-sm">
            {t("history.filterChannel")}
          </span>
          <Select
            value={channel || "all"}
            onValueChange={(value) =>
              setFilters({ channel: value === "all" ? "" : value })
            }
          >
            <SelectTrigger
              className="w-full md:w-44"
              aria-label={t("history.filterChannel")}
            >
              <SelectValue placeholder={t("history.allChannels")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("history.allChannels")}</SelectItem>
              {selectableChannels.map((id) => (
                <SelectItem key={id} value={id}>
                  {channelLabel(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs
          value={status}
          onValueChange={(value) =>
            setFilters({ status: value as StatusFilter })
          }
          className="w-full md:w-auto"
        >
          <TabsList
            aria-label={t("history.filterStatus")}
            className="w-full md:w-auto"
          >
            <TabsTrigger value="all" className="flex-1 md:flex-none">
              {t("history.filterAll")}
            </TabsTrigger>
            <TabsTrigger value="true" className="flex-1 md:flex-none">
              {t("history.filterSuccess")}
            </TabsTrigger>
            <TabsTrigger value="false" className="flex-1 md:flex-none">
              {t("history.filterFailed")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(history.length === 0);
            fetchHistory();
          }}
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
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            ),
          )}
        </div>
      ) : grouped.length === 0 ? (
        !error &&
        (hasFilters ? (
          <EmptyState
            icon={<History className="w-6 h-6" />}
            title={t("history.emptyFilteredTitle")}
            description={t("history.emptyFilteredDesc")}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t("history.clearFilters")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<History className="w-6 h-6" />}
            title={t("history.emptyTitle")}
            description={t("history.emptyDesc")}
          />
        ))
      ) : (
        <div
          aria-busy={fetching}
          className={cn(
            "transition-opacity duration-(--duration-standard)",
            fetching && "opacity-60",
          )}
        >
          {/* Desktop table */}
          <div className="hidden md:block rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    t("history.title_col"),
                    t("history.channel"),
                    t("common.status"),
                    t("history.time"),
                    t("common.actions"),
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-caption font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {groupedByDay.map(([day, rows]) => (
                  <Fragment key={`day-${day}`}>
                    <tr>
                      <th
                        colSpan={5}
                        scope="rowgroup"
                        className="sticky top-0 z-10 bg-muted/80 px-4 py-2 text-left text-caption font-medium uppercase tracking-wide text-muted-foreground backdrop-blur"
                      >
                        {day}
                      </th>
                    </tr>
                    {rows.map((g) => (
                      <tr
                        key={g.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => setSelected(g)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 max-w-xs items-center gap-1.5">
                            <p className="truncate font-medium">{g.title}</p>
                            <SourceBadge source={g.trigger_source} />
                          </div>
                          {g.item_name && (
                            <p className="text-xs text-muted-foreground">
                              {g.item_name}
                            </p>
                          )}
                          {g.channels.some((c) => c.error) && (
                            <p className="text-xs text-destructive truncate max-w-xs">
                              {g.channels
                                .filter((c) => c.error)
                                .map((c) => `${c.channel}: ${c.error}`)
                                .join("; ")}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {g.channels.map((c) => (
                              <span
                                key={`${g.id}-${c.channel}`}
                                className={`uppercase text-caption px-1.5 py-0.5 rounded-xs ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
                              >
                                {c.channel}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {g.allSuccess ? (
                            <span className="inline-flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-3 h-3" />
                              {t("history.success")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                              <XCircle className="w-3 h-3" />
                              {t("history.failed")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums text-body-sm">
                          {new Date(g.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={(e) => handleClear(e, g)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title={t("common.clear")}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {groupedByDay.map(([day, rows]) => (
              <div key={`m-day-${day}`} className="space-y-3">
                <h2 className="sticky -top-px z-10 -mx-1 bg-background/90 px-1 py-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {day}
                </h2>
                {rows.map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    className="bg-card rounded-xl border p-4 space-y-2 cursor-pointer active:bg-muted/30 transition-colors w-full min-w-0"
                    onClick={() => setSelected(g)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate text-sm font-medium">
                            {g.title}
                          </p>
                          <SourceBadge source={g.trigger_source} />
                        </div>
                        {g.item_name && (
                          <p className="text-xs text-muted-foreground">
                            {g.item_name}
                          </p>
                        )}
                      </div>
                      {g.allSuccess ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-full shrink-0">
                          <CheckCircle className="w-3 h-3" />
                          {t("history.success")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full shrink-0">
                          <XCircle className="w-3 h-3" />
                          {t("history.failed")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {g.channels.map((c) => (
                          <span
                            key={`${g.id}-${c.channel}`}
                            className={`uppercase text-caption px-1.5 py-0.5 rounded-xs ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
                          >
                            {c.channel}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(g.created_at).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleClear(e, g)}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title={t("common.clear")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {g.channels.some((c) => c.error) && (
                      <p className="text-xs text-destructive truncate">
                        {g.channels
                          .filter((c) => c.error)
                          .map((c) => `${c.channel}: ${c.error}`)
                          .join("; ")}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("history.detail")}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelected(null);
          }}
        >
          <button
            type="button"
            aria-label="Close details"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40 animate-dialog-backdrop"
            onClick={() => setSelected(null)}
          />
          <div
            ref={detailTrapRef}
            className="relative bg-card border rounded-lg w-full max-w-lg shadow-4 flex flex-col max-h-[80vh] animate-dialog-panel"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <h3 className="text-title">{t("history.detail")}</h3>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto">
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  {t("history.title_col")}
                </p>
                <div className="flex items-start gap-1.5">
                  <p className="min-w-0 flex-1 break-words text-sm font-medium">
                    {selected.title}
                  </p>
                  <SourceBadge source={selected.trigger_source} />
                </div>
                {selected.item_name && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selected.item_name}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  {t("history.content")}
                </p>
                {selected.body ? (
                  <pre className="text-sm bg-muted rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed">
                    {selected.body}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {t("history.noContent")}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <div className="flex flex-wrap gap-1">
                  {selected.channels.map((c) => (
                    <span
                      key={`${selected.id}-${c.channel}`}
                      className={`uppercase text-caption px-1.5 py-0.5 rounded-xs ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
                    >
                      {c.channel}
                    </span>
                  ))}
                </div>
                <span className="shrink-0">
                  {new Date(selected.created_at).toLocaleString()}
                </span>
              </div>
              {selected.channels.some((c) => c.error) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("history.failureReason")}
                  </p>
                  <div className="space-y-2">
                    {selected.channels
                      .filter((c) => c.error)
                      .map((c) => (
                        <div
                          key={`${c.channel}-${c.error}`}
                          className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2"
                        >
                          <span className="inline-flex uppercase text-caption px-1.5 py-0.5 rounded-xs bg-destructive/10 text-destructive">
                            {c.channel}
                          </span>
                          <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-body-sm leading-relaxed text-destructive">
                            {c.error}
                          </pre>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        message={confirm?.message || ""}
        variant="danger"
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirm?.onConfirm || (() => {})}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

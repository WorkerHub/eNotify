import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle, XCircle, History, X, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { NotificationHistory } from "@/types";

interface GroupedHistory {
  id: string;
  title: string;
  body: string | null;
  item_name?: string;
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
      if (!r.success) last.allSuccess = false;
    } else {
      groups.push({
        id: r.id,
        title: r.title,
        body: r.body,
        item_name: r.item_name,
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

export function HistoryPage() {
  const { t } = useTranslation();
  const [history, setHistory] = useState<NotificationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<GroupedHistory | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await api.get<NotificationHistory[]>(
        "/me/notification-history?limit=200",
      );
      setHistory(data);
    } catch (e: any) {
      setError(e.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const grouped = groupHistory(history);

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
        for (const r of groupRecords) {
          try {
            await api.delete(`/me/notification-history/${r.id}`);
          } catch {
            /* ignore individual errors */
          }
        }
        setHistory((prev) =>
          prev.filter((r) => !groupRecords.some((gr) => gr.id === r.id)),
        );
      },
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("history.title")}</h1>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => `skeleton-${i + 1}`).map(
            (skeletonKey) => (
              <div
                key={skeletonKey}
                className="h-16 bg-muted rounded-lg animate-pulse"
              />
            ),
          )}
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>{t("history.noData")}</p>
        </div>
      ) : (
        <>
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
                      className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {grouped.map((g) => (
                  <tr
                    key={g.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelected(g)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-xs">{g.title}</p>
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
                            className={`uppercase text-xs px-1.5 py-0.5 rounded ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
                          >
                            {c.channel}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {g.allSuccess ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full">
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
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
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
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {grouped.map((g) => (
              <button
                type="button"
                key={g.id}
                className="bg-card rounded-xl border p-4 space-y-2 cursor-pointer active:bg-muted/30 transition-colors"
                onClick={() => setSelected(g)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{g.title}</p>
                    {g.item_name && (
                      <p className="text-xs text-muted-foreground">
                        {g.item_name}
                      </p>
                    )}
                  </div>
                  {g.allSuccess ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded-full shrink-0">
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
                        className={`uppercase text-xs px-1.5 py-0.5 rounded ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
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
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close details"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSelected(null)}
          />
          <div className="relative bg-card border rounded-xl w-full max-w-lg shadow-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <h3 className="font-semibold text-sm">{t("history.detail")}</h3>
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
                <p className="text-sm font-medium">{selected.title}</p>
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
                      className={`uppercase px-1.5 py-0.5 rounded ${c.success ? "text-muted-foreground bg-muted" : "text-destructive bg-destructive/10"}`}
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
                <p className="text-xs text-destructive">
                  {selected.channels
                    .filter((c) => c.error)
                    .map((c) => `${c.channel}: ${c.error}`)
                    .join("\n")}
                </p>
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

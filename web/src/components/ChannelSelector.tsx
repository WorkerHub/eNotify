import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, X, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CHANNELS } from "@/lib/channels";
import type { NotificationConfig } from "@/types";

export function ChannelSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (channels: string[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [enabledChannels, setEnabledChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const config = await api.get<NotificationConfig>("/me/notifications");
        setEnabledChannels(config.enabled_channels || []);
      } catch {
        setEnabledChannels([]);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const availableChannels = CHANNELS.filter((ch) =>
    enabledChannels.includes(ch.id),
  );

  const toggleChannel = (channelId: string) => {
    const newSelected = selected.includes(channelId)
      ? selected.filter((c) => c !== channelId)
      : [...selected, channelId];
    onChange(newSelected);
  };

  const clearSelection = () => {
    onChange([]);
  };

  const toggleAll = () => {
    if (selected.length === availableChannels.length) {
      onChange([]);
    } else {
      onChange(availableChannels.map((ch) => ch.id));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <label className="text-sm font-medium">
        {t("channels.selectChannels")}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "mt-1.5 w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-background text-sm text-left",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow",
          open && "ring-2 ring-primary/50",
        )}
      >
        <span className="text-foreground">
          {selected.length === 0
            ? t("channels.allChannels")
            : t("channels.selectedChannels", { count: selected.length })}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-card border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {availableChannels.length} {t("common.available")}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs px-2 py-1 rounded bg-background hover:bg-accent text-foreground"
                >
                  {selected.length === availableChannels.length
                    ? t("common.clear")
                    : t("common.selectAll")}
                </button>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-xs px-2 py-1 rounded bg-background hover:bg-accent text-destructive"
                  >
                    {t("common.clear")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto p-1">
            {loading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : availableChannels.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t("channels.noChannelsEnabled")}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-accent",
                    selected.length === 0 && "bg-accent",
                  )}
                  onClick={() => onChange([])}
                >
                  <div className="w-4 h-4 rounded-full border flex items-center justify-center">
                    {selected.length === 0 && <Radio className="w-3 h-3" />}
                  </div>
                  <span className="text-sm flex-1">
                    {t("channels.allChannels")}
                  </span>
                  {selected.length === 0 && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>

                {availableChannels.map((channel) => (
                  <button
                    type="button"
                    key={channel.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-accent",
                      selected.includes(channel.id) && "bg-accent",
                    )}
                    onClick={() => toggleChannel(channel.id)}
                  >
                    <div className="w-4 h-4 rounded-full border flex items-center justify-center">
                      {selected.includes(channel.id) && (
                        <Radio className="w-3 h-3" />
                      )}
                    </div>
                    <span className="text-sm flex-1">{channel.label}</span>
                    {selected.includes(channel.id) && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((channelId) => {
            const channel = CHANNELS.find((ch) => ch.id === channelId);
            if (!channel) return null;
            return (
              <span
                key={channelId}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs"
              >
                {channel.label}
                <button
                  type="button"
                  onClick={() => toggleChannel(channelId)}
                  className="hover:text-primary/70"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

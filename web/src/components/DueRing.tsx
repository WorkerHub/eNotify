import { cn } from "@/lib/utils";

/**
 * Countdown urgency tiers — the single semantic color gradient of the
 * design system (design contract §3.1 / §4.6).
 */
export type DueTier = "far" | "soon" | "close" | "over";

export function getDueTier(days: number): DueTier {
  if (days < 0) return "over";
  if (days <= 7) return "close";
  if (days <= 30) return "soon";
  return "far";
}

const TIER_TEXT: Record<DueTier, string> = {
  far: "text-due-far",
  soon: "text-due-soon",
  close: "text-due-close",
  over: "text-due-over",
};

const TIER_BADGE: Record<DueTier, string> = {
  far: "bg-due-far/10 text-due-far",
  soon: "bg-due-soon/10 text-due-soon",
  close: "bg-due-close/10 text-due-close",
  over: "bg-due-over/10 text-due-over",
};

export function dueTierTextClass(days: number): string {
  return TIER_TEXT[getDueTier(days)];
}

export function dueTierBadgeClass(days: number): string {
  return TIER_BADGE[getDueTier(days)];
}

/** Circular remaining-progress ring (design contract §3.1 — countdown is first-class). */
export function DueRing({
  days,
  progress,
  size = 28,
  strokeWidth = 3,
  className,
}: {
  days: number;
  /** 0..1 — fraction of the period still remaining */
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const tier = getDueTier(days);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 -rotate-90", TIER_TEXT[tier], className)}
      role="img"
      aria-label={`${days}d`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
      />
    </svg>
  );
}

/** Ledger-style countdown: large tabular numeral + small unit (§3.1, Cron-style asymmetric type). */
export function DueCount({
  days,
  unit,
  size = "md",
  className,
}: {
  days: number;
  unit: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tier = getDueTier(days);
  const numCls =
    size === "lg"
      ? "text-display-lg"
      : size === "md"
        ? "text-display"
        : "text-title";
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1",
        TIER_TEXT[tier],
        className,
      )}
    >
      <span className={cn(numCls, "tabular-nums leading-none")}>
        {days < 0 ? `-${Math.abs(days)}` : days}
      </span>
      <span className="text-caption">{unit}</span>
    </span>
  );
}

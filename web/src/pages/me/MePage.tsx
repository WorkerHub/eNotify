import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { DashboardStats } from "@/types";
import {
  User,
  ChevronRight,
  Settings,
  Shield,
  Info,
  LogOut,
} from "lucide-react";

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 bg-card hover:bg-accent transition-colors"
    >
      <Icon
        className={`w-5 h-5 ${destructive ? "text-destructive" : "text-muted-foreground"}`}
      />
      <span
        className={`flex-1 text-left text-body-sm ${destructive ? "text-destructive" : "text-foreground"}`}
      >
        {label}
      </span>
      <ChevronRight
        className={`w-4 h-4 ${destructive ? "text-destructive/50" : "text-muted-foreground/50"}`}
      />
    </button>
  );
}

export function MePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  // This-month due count for the ledger head
  const [dueCount, setDueCount] = useState<number | null>(null);
  useEffect(() => {
    const now = new Date();
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
    api
      .get<DashboardStats>("/dashboard/stats")
      .then((stats) => {
        const count = [
          ...stats.subscription.upcoming_renewals.map((r) => r.expiry_date),
          ...stats.regular.upcoming_reminders.map((r) => r.expiry_date),
        ].filter((d) => d <= monthEnd).length;
        setDueCount(count);
      })
      .catch(() => setDueCount(null));
  }, []);

  return (
    <div className="max-w-lg mx-auto">
      {/* Profile card — "ledger head": avatar + email + this-month due count (§5 me) */}
      <div className="flex flex-col items-center py-8 mb-6">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <User className="w-8 h-8 text-primary" />
        </div>
        <p className="text-body-strong">{user?.email}</p>
        {dueCount != null && (
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="text-display tabular-nums text-primary leading-none">
              {dueCount}
            </span>
            <span className="text-caption text-muted-foreground">
              {t("me.entries")} · {t("me.dueThisMonth")}
            </span>
          </p>
        )}
      </div>

      {/* Menu items */}
      <div className="mb-4">
        <div className="rounded-lg border overflow-hidden divide-y">
          <MenuItem
            icon={Settings}
            label={t("nav.settings")}
            onClick={() => navigate("/settings")}
          />
          {user?.role === "admin" && (
            <MenuItem
              icon={Shield}
              label={t("nav.admin")}
              onClick={() => navigate("/admin")}
            />
          )}
          <MenuItem
            icon={Info}
            label={t("nav.about")}
            onClick={() => navigate("/about")}
          />
        </div>
      </div>

      {/* Logout */}
      <div className="mt-6">
        <div className="rounded-lg border overflow-hidden">
          <MenuItem
            icon={LogOut}
            label={t("auth.logout")}
            onClick={handleLogout}
            destructive
          />
        </div>
      </div>
    </div>
  );
}

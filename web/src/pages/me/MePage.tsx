import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
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
        className={`flex-1 text-left text-sm ${destructive ? "text-destructive" : "text-foreground"}`}
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

  return (
    <div className="max-w-lg mx-auto">
      {/* Profile card */}
      <div className="flex flex-col items-center py-8 mb-4">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-3">
          <User className="w-8 h-8 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">{user?.email}</p>
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

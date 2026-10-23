import { Outlet, NavLink, useNavigate, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import {
  LayoutDashboard,
  CreditCard,
  Shield,
  LogOut,
  XCircle,
  Settings,
  History,
  User,
  ChevronDown,
  Info,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { usePWAUpdate } from "@/hooks/usePWAUpdate";
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { ItemListPage } from "@/pages/items/ItemListPage";
import { ChannelPage } from "@/pages/channels/ChannelPage";
import { HistoryPage } from "@/pages/history/HistoryPage";
import { MePage } from "@/pages/me/MePage";

function AvatarDropdown({
  user,
  onLogout,
  onNavigate,
}: {
  user: { email: string; role: string } | null;
  onLogout: () => void;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleNavigate = (path: string) => {
    setOpen(false);
    onNavigate(path);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
          <User className="w-4 h-4 text-primary" />
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-lg shadow-3 py-1 z-50">
          <div className="px-3 py-2 border-b">
            <p className="text-sm font-medium truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => handleNavigate("/settings")}
            className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors"
          >
            <Settings className="w-4 h-4" />
            {t("nav.settings")}
          </button>
          {user?.role === "admin" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleNavigate("/admin")}
              className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:bg-accent"
            >
              <Shield className="w-4 h-4" />
              {t("nav.admin")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleNavigate("/about")}
            className="flex items-center gap-2 px-3 py-2 text-sm w-full text-muted-foreground hover:bg-accent transition-colors"
          >
            <Info className="w-4 h-4" />
            {t("nav.about")}
          </button>
          <div className="border-t mt-1 pt-1">
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-2 text-sm w-full text-destructive hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4" />
              {t("auth.logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { needRefresh, update, dismiss } = usePWAUpdate();
  const [impersonating, setImpersonating] = useState(
    () => !!sessionStorage.getItem("impersonate_user_id"),
  );
  const [appName, setAppName] = useState("eNotify");

  const TAB_PATHS = ["/", "/items", "/channels", "/history", "/me"];
  const isTabPath = TAB_PATHS.includes(location.pathname);
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(
    () => new Set([location.pathname]),
  );

  useEffect(() => {
    if (isTabPath) {
      setVisitedTabs((prev) => {
        if (prev.has(location.pathname)) return prev;
        return new Set(prev).add(location.pathname);
      });
    }
  }, [isTabPath, location.pathname]);

  useEffect(() => {
    api
      .get<{ app_name: string; version: string }>("/system/info")
      .then((info) => {
        if (info.app_name) setAppName(info.app_name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const check = () =>
      setImpersonating(!!sessionStorage.getItem("impersonate_user_id"));
    window.addEventListener("storage", check);
    window.addEventListener("impersonation-change", check);
    return () => {
      window.removeEventListener("storage", check);
      window.removeEventListener("impersonation-change", check);
    };
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("needs_2fa_setup")) {
      sessionStorage.removeItem("needs_2fa_setup");
      navigate("/settings?tab=security", { replace: true });
    }
  }, [navigate]);

  const stopImpersonating = async () => {
    sessionStorage.removeItem("impersonate_user_id");
    window.dispatchEvent(new Event("impersonation-change"));
    setImpersonating(false);
    await refreshUser();
    navigate("/admin/users");
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleMenuNavigate = (path: string) => {
    navigate(path);
  };

  const desktopNavItems = [
    { to: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/items", icon: CreditCard, label: t("nav.items") },
    { to: "/channels", icon: Radio, label: t("nav.channels") },
    { to: "/history", icon: History, label: t("nav.history") },
  ];

  const mobileNavItems = [
    { to: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/items", icon: CreditCard, label: t("nav.items") },
    { to: "/channels", icon: Radio, label: t("nav.channels") },
    { to: "/history", icon: History, label: t("nav.history") },
    { to: "/me", icon: User, label: t("nav.me") },
  ];

  return (
    <div className="h-dvh flex flex-col md:flex-row md:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:w-64 md:flex-col bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 border-r">
        <div className="h-14 flex items-center px-4 border-b">
          <h1 className="text-title text-primary">
            {appName}
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-1 w-1 rounded-full bg-primary align-baseline"
            />
          </h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {desktopNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-md text-body-sm transition-colors duration-(--duration-fast) ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                    : "text-muted-foreground hover:bg-accent"
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 pt-[calc(3rem+env(safe-area-inset-top,0px))] pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:ml-64 md:h-dvh md:overflow-y-auto md:pt-14 md:pb-0">
        {/* Desktop top bar */}
        <div className="hidden md:fixed md:top-0 md:left-64 md:right-0 md:z-30 md:flex items-center justify-end gap-2 px-6 h-14 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 shadow-sm">
          <AvatarDropdown
            user={user}
            onLogout={handleLogout}
            onNavigate={handleMenuNavigate}
          />
        </div>

        {impersonating && (
          <div className="bg-warning/90 text-warning-foreground text-body-sm px-4 py-2 flex items-center justify-between">
            <span>
              {t("admin.impersonating", {
                defaultValue: "Impersonating another user",
              })}
            </span>
            <button
              type="button"
              onClick={stopImpersonating}
              className="flex items-center gap-1 font-medium hover:underline"
            >
              <XCircle className="w-4 h-4" />
              {t("common.stop", { defaultValue: "Stop" })}
            </button>
          </div>
        )}

        {needRefresh && (
          <div className="bg-info/90 text-info-foreground text-body-sm px-4 py-2 flex items-center justify-between">
            <span>{t("pwa.updateAvailable")}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={update}
                className="flex items-center gap-1 font-medium hover:underline"
              >
                <RefreshCw className="w-4 h-4" />
                {t("pwa.updateAction")}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="opacity-70 hover:opacity-100"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="px-4 pt-6 pb-4 md:px-6 md:pt-8 md:pb-6 max-w-5xl mx-auto">
          {/* Desktop: always use Outlet (keyed → page entrance re-runs per route) */}
          <div key={location.pathname} className="hidden md:block motion-enter">
            <Outlet />
          </div>
          {/* Mobile: KeepAlive for tab pages, Outlet for non-tab pages */}
          <div className="md:hidden">
            {isTabPath ? (
              <>
                <div
                  style={{
                    display: location.pathname === "/" ? "block" : "none",
                  }}
                >
                  {visitedTabs.has("/") && <DashboardPage />}
                </div>
                <div
                  style={{
                    display: location.pathname === "/items" ? "block" : "none",
                  }}
                >
                  {visitedTabs.has("/items") && <ItemListPage />}
                </div>
                <div
                  style={{
                    display:
                      location.pathname === "/channels" ? "block" : "none",
                  }}
                >
                  {visitedTabs.has("/channels") && <ChannelPage />}
                </div>
                <div
                  style={{
                    display:
                      location.pathname === "/history" ? "block" : "none",
                  }}
                >
                  {visitedTabs.has("/history") && <HistoryPage />}
                </div>
                <div
                  style={{
                    display: location.pathname === "/me" ? "block" : "none",
                  }}
                >
                  {visitedTabs.has("/me") && <MePage />}
                </div>
              </>
            ) : (
              <div key={location.pathname} className="motion-enter">
                <Outlet />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 bg-card border-b flex items-center px-4 z-50"
        style={{
          height: "calc(3rem + env(safe-area-inset-top, 0px))",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <span className="text-title text-primary">
          {appName}
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-1 w-1 rounded-full bg-primary align-baseline"
          />
        </span>
      </header>

      {/* Mobile bottom nav — shared pill indicator slides to the active tab
          (design contract §5: 200ms ease-out; transform-only) */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t z-50"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingTop: "0.5rem",
        }}
      >
        <div className="relative flex justify-around">
          {(() => {
            const activeIndex = mobileNavItems.findIndex(
              (item) => item.to === location.pathname,
            );
            return (
              <span
                aria-hidden="true"
                className="absolute top-0 bottom-1 rounded-full bg-primary/10 transition-transform duration-(--duration-standard) ease-(--ease-out)"
                style={{
                  width: `${100 / mobileNavItems.length}%`,
                  transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
                  opacity: activeIndex < 0 ? 0 : 1,
                }}
              />
            );
          })()}
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `relative z-10 flex flex-col items-center justify-center gap-1 px-3 py-1 min-h-11 min-w-11 text-caption transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-full ${
                  isActive ? "text-primary font-medium" : "text-muted-foreground"
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

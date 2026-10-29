import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ShoppingCart,
  FileSpreadsheet,
  History,
  Wallet,
  Package,
  Calendar,
  CreditCard,
  FileBarChart,
  Settings,
  Wifi,
  WifiOff,
  RefreshCw,
  Moon,
  Sun,
  LogOut,
  Globe,
  Building2,
} from 'lucide-react';
import { APP_MODULES, AppModule, BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { checkServerHealth } from '../api/client';

const MODULE_ROUTE_CONFIG: Record<
  AppModule,
  { path: string; icon: React.ComponentType<{ className?: string }>; group: 'POS' | 'OPS' | 'FINANCE' }
> = {
  DASHBOARD: { path: '/', icon: LayoutDashboard, group: 'POS' },
  SALES_POINT: { path: '/pos', icon: ShoppingCart, group: 'POS' },
  QUOTATIONS: { path: '/quotations', icon: FileSpreadsheet, group: 'POS' },
  SALES_HISTORY: { path: '/sales-history', icon: History, group: 'POS' },
  INVENTORY: { path: '/inventory', icon: Package, group: 'OPS' },
  APPOINTMENTS: { path: '/appointments', icon: Calendar, group: 'OPS' },
  CREDIT_RECORDS: { path: '/credit', icon: CreditCard, group: 'FINANCE' },
  EXPENSES: { path: '/expenses', icon: Wallet, group: 'FINANCE' },
  REPORTS: { path: '/reports', icon: FileBarChart, group: 'FINANCE' },
  SETTINGS: { path: '/settings', icon: Settings, group: 'FINANCE' },
};

const NAV_GROUPS: Array<{ key: 'POS' | 'OPS' | 'FINANCE'; labelEn: string; labelSo: string }> = [
  { key: 'POS', labelEn: 'OVERVIEW & SALES', labelSo: 'XOGTA & IIBKA' },
  { key: 'OPS', labelEn: 'STOCK & CLINICAL', labelSo: 'BAKHAARKA & BALLAMAHA' },
  { key: 'FINANCE', labelEn: 'FINANCE & SYSTEM', labelSo: 'MAALIYADDA & DEJINTA' },
];

export const AppShellLayout: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    accessToken,
    activeBranchId,
    setActiveBranchId,
    canViewModule,
    logout,
  } = useAuth();

  const [isServerHealthy, setIsServerHealthy] = useState<boolean>(true);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    () => localStorage.getItem('baxnaano_theme') === 'dark'
  );

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('baxnaano_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('baxnaano_theme', 'light');
    }
  }, [darkMode]);

  const checkHealth = async () => {
    if (!navigator.onLine) {
      setIsServerHealthy(false);
      return;
    }
    setIsCheckingHealth(true);
    try {
      const ok = await checkServerHealth();
      setIsServerHealthy(ok);
    } catch {
      setIsServerHealthy(false);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    checkHealth();

    const onOnline = () => checkHealth();
    const onOffline = () => setIsServerHealthy(false);
    const onWindowFocus = () => checkHealth();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onWindowFocus);

    // Periodic live health check every 15 seconds
    const interval = setInterval(checkHealth, 15000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onWindowFocus);
      clearInterval(interval);
    };
  }, []);

  const visibleModules = APP_MODULES.filter((mod) => canViewModule(mod));

  const toggleLanguage = () => {
    const next = i18n.language === 'en' ? 'so' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('baxnaano_lang_v2', next);
  };

  const activeBranchMeta = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === activeBranchId || b.code === activeBranchId
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-100/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased">
      {/* Left Sidebar Navigation (Sticky on Desktop, Compact & Scannable) */}
      <aside className="print:hidden w-full md:w-64 md:h-screen md:sticky md:top-0 bg-white dark:bg-slate-900 border-b md:border-b-0 md:border-r border-slate-200/90 dark:border-slate-800 flex flex-col justify-between shrink-0 z-20">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Uncluttered Brand Identity Header */}
          <div className="h-16 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-3 shrink-0">
            <img
              src="/baxnaano-logo.jpg"
              alt="Baxnaano Logo"
              className="w-10 h-10 rounded-full object-cover border-2 border-emerald-500/30 shadow-sm shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-base text-emerald-700 dark:text-emerald-400 tracking-tight whitespace-nowrap leading-tight">
                BAXNAANO SYSTEM
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Pharmacy & Veterinary ERP
              </div>
            </div>
          </div>

          {/* Categorized Navigation Links (Desktop) */}
          <nav className="hidden md:flex flex-col flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {NAV_GROUPS.map((group) => {
              const groupModules = visibleModules.filter(
                (mod) => MODULE_ROUTE_CONFIG[mod].group === group.key
              );
              if (groupModules.length === 0) return null;

              return (
                <div key={group.key} className="space-y-1">
                  <div className="px-3 text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">
                    {i18n.language === 'so' ? group.labelSo : group.labelEn}
                  </div>
                  {groupModules.map((mod) => {
                    const cfg = MODULE_ROUTE_CONFIG[mod];
                    const Icon = cfg.icon;
                    return (
                      <NavLink
                        key={mod}
                        to={cfg.path}
                        end={cfg.path === '/'}
                        className={({ isActive }) =>
                          `px-3 py-2 rounded-xl font-semibold text-[13px] flex items-center gap-2.5 whitespace-nowrap transition-all ${
                            isActive
                              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                          }`
                        }
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{t(`nav.${mod}`)}</span>
                      </NavLink>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Horizontal Scroll Navigation (Mobile/Tablet) */}
          <nav className="flex md:hidden overflow-x-auto px-3 py-2 gap-1.5 border-t border-slate-100 dark:border-slate-800">
            {visibleModules.map((mod) => {
              const cfg = MODULE_ROUTE_CONFIG[mod];
              const Icon = cfg.icon;
              return (
                <NavLink
                  key={mod}
                  to={cfg.path}
                  end={cfg.path === '/'}
                  className={({ isActive }) =>
                    `px-3 py-2 rounded-xl font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap transition ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{t(`nav.${mod}`)}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* User Profile & Logout Footer */}
        <div className="hidden md:flex px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 items-center justify-between bg-slate-50/60 dark:bg-slate-900/50 shrink-0">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
              {user?.fullName}
            </div>
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span>{user?.role}</span>
              <span>•</span>
              <span>
                {activeBranchId === 'ALL'
                  ? 'All Branches'
                  : activeBranchMeta?.code || activeBranchId}
              </span>
            </div>
          </div>
          <button
            onClick={logout}
            title={t('auth.logout')}
            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Sticky Top Utility Bar — Responsive Two-Row on Mobile, Single-Row on Desktop */}
        <header className="print:hidden sticky top-0 z-10 min-h-[4rem] py-2 px-3 md:px-6 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 shrink-0">
          {/* Left / Bottom on Mobile: Branch Scope Selector / Indicator */}
          <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto order-2 sm:order-1">
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
              <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="hidden lg:inline">Branch Scope:</span>
            </div>

            {user?.role === 'ADMIN' ? (
              <div className="grid grid-cols-4 sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setActiveBranchId('ALL')}
                  className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-bold transition whitespace-nowrap text-center ${
                    activeBranchId === 'ALL'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span className="sm:hidden">All</span>
                  <span className="hidden sm:inline">All (B1–B3)</span>
                </button>
                {Object.values(BAXNAANO_BRANCHES).map((b) => {
                  const isSelected = activeBranchId === b.id || activeBranchId === b.code;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setActiveBranchId(b.id)}
                      title={`${b.code}: ${b.name} (${b.location})`}
                      className={`px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-bold transition whitespace-nowrap text-center ${
                        isSelected
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <span className="md:hidden">{b.code}</span>
                      <span className="hidden md:inline">
                        {b.code} • {b.location}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300 truncate w-full sm:w-auto text-center sm:text-left">
                {activeBranchMeta
                  ? `${activeBranchMeta.code} — ${activeBranchMeta.name} (${activeBranchMeta.location})`
                  : activeBranchId}
              </div>
            )}
          </div>

          {/* Right / Top on Mobile: Server Health Status, Language Toggle, Theme Toggle & Logout */}
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0 order-1 sm:order-2">
            {/* Live Authoritative Server Connection Indicator */}
            <button
              type="button"
              onClick={checkHealth}
              title={
                isServerHealthy
                  ? t('sync.server_connected')
                  : t('sync.server_disconnected')
              }
              className={`h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition ${
                isServerHealthy
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 animate-pulse'
              }`}
            >
              {isServerHealthy ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
              )}
              <span>{isServerHealthy ? t('sync.online') : t('sync.offline')}</span>
              {isCheckingHealth && (
                <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />
              )}
            </button>

            <div className="flex items-center gap-1.5">
              {/* Flexible Language Switcher Button */}
              <button
                type="button"
                onClick={toggleLanguage}
                title="Switch Language (English / Af-Soomaali)"
                className="h-9 px-2.5 sm:px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{i18n.language === 'so' ? 'SO • Soomaali' : 'EN • English'}</span>
              </button>

              {/* Dark / Light Mode Toggle */}
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                title="Toggle Light / Dark Theme"
                className="h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center transition shrink-0"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-slate-600" />
                )}
              </button>

              {/* Mobile Logout Button */}
              <button
                type="button"
                onClick={logout}
                title={t('auth.logout')}
                className="md:hidden h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-600 dark:text-slate-300 hover:text-red-600 flex items-center justify-center transition shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>

              {/* Quick POS Launch Button (when not already on /pos) */}
              {location.pathname !== '/pos' && canViewModule('SALES_POINT') && (
                <button
                  type="button"
                  onClick={() => navigate('/pos')}
                  className="hidden lg:flex h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold items-center gap-1.5 shadow-sm transition whitespace-nowrap"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>{t('nav.SALES_POINT')}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Server Disconnected Warning Banner */}
        {!isServerHealthy && (
          <div className="bg-red-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between gap-3 shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0 animate-bounce" />
              <span>{t('sync.server_disconnected')}</span>
            </div>
            <button
              onClick={checkHealth}
              disabled={isCheckingHealth}
              className="bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded text-xs font-bold transition shrink-0 whitespace-nowrap"
            >
              {isCheckingHealth ? t('sync.server_reconnecting') : 'Retry Connection'}
            </button>
          </div>
        )}

        {/* Main Page Content */}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

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
  AlertTriangle,
  Download,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { APP_MODULES, AppModule, BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { checkServerHealth } from '../api/client';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

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
    activeBranchId,
    setActiveBranchId,
    canViewModule,
    logout,
  } = useAuth();

  const isOnline = useOnlineStatus();
  const [isServerHealthy, setIsServerHealthy] = useState<boolean>(true);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [darkMode, setDarkMode] = useState<boolean>(
    () => localStorage.getItem('baxnaano_theme') === 'dark'
  );

  // Close mobile drawer automatically on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

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

  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone] = useState<boolean>(() => {
    return (
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true)
    );
  });

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert(
        i18n.language === 'so'
          ? 'Si aad ugu shubato aaladdaada:\n• Chrome/Edge (PC/Android): Guji astaanta "Install App" ee address bar-ka.\n• iPhone/iPad (Safari): Taabo badhanka Share ⎋ kadibna dooro "Add to Home Screen".'
          : 'To install Baxnaano on your device:\n• Chrome/Edge (PC/Android): Click the Install icon in the browser address bar.\n• iPhone/iPad (Safari): Tap the Share button ⎋ and choose "Add to Home Screen".'
      );
    }
  };

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

  // Quick bottom navigation modules for mobile
  const mobilePrimaryTabs: AppModule[] = (
    ['DASHBOARD', 'SALES_POINT', 'INVENTORY', 'CREDIT_RECORDS'] as AppModule[]
  ).filter((m) => visibleModules.includes(m));

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-100/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased pb-16 md:pb-0">
      {/* Desktop Left Sidebar Navigation (Hidden on Mobile) */}
      <aside className="print:hidden hidden md:flex md:w-60 md:h-screen md:sticky md:top-0 bg-white dark:bg-slate-900 border-r border-slate-200/90 dark:border-slate-800 flex-col justify-between shrink-0 z-20">
        <div className="flex flex-col flex-1 min-h-0">
          {/* Brand Identity Header */}
          <div className="h-16 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-3 shrink-0">
            <img
              src="/baxnaano-logo.jpg"
              alt="Baxnaano Logo"
              className="w-9 h-9 rounded-full object-cover border-2 border-emerald-500/30 shadow-sm shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-sm text-emerald-700 dark:text-emerald-400 tracking-tight whitespace-nowrap leading-tight">
                BAXNAANO SYSTEM
              </div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Pharmacy & Veterinary ERP
              </div>
            </div>
          </div>

          {/* Categorized Navigation Links */}
          <nav className="flex flex-col flex-1 overflow-y-auto px-3 py-3 space-y-4">
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
        </div>

        {/* User Profile & Logout Footer */}
        <div className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-900/50 shrink-0">
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

      {/* Mobile Slide-Out Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="print:hidden fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-72 max-w-[82vw] bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col justify-between z-10 border-r border-slate-200 dark:border-slate-800">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/baxnaano-logo.jpg"
                  alt="Baxnaano Logo"
                  className="w-9 h-9 rounded-full object-cover border border-emerald-500/40 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-extrabold text-sm text-emerald-600 dark:text-emerald-400 tracking-tight truncate">
                    BAXNAANO SYSTEM
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    Pharmacy & Veterinary ERP
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Categorized Navigation Links */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
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
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            `px-3 py-2.5 rounded-xl font-semibold text-xs flex items-center justify-between transition-all ${
                              isActive
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`
                          }
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{t(`nav.${mod}`)}</span>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 opacity-50 shrink-0" />
                        </NavLink>
                      );
                    })}
                  </div>
                );
              })}

              {!isStandalone && (
                <div className="pt-2 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleInstallClick();
                    }}
                    className="w-full py-2.5 px-3 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Install Baxnaano App</span>
                  </button>
                </div>
              )}
            </nav>

            {/* Drawer User Footer */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {user?.fullName}
                  </div>
                  <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {user?.role} • {activeBranchId === 'ALL' ? 'All Branches' : activeBranchMeta?.code || activeBranchId}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="w-full py-2 px-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 text-xs font-bold flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('auth.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {(!isOnline || !isServerHealthy) && (
          <div className="bg-amber-500 text-slate-950 font-bold px-3 py-2 text-center text-xs shadow-md flex items-center justify-center gap-2 sticky top-0 z-40">
            <AlertTriangle className="w-4 h-4 shrink-0 text-slate-950" />
            <span className="truncate">
              {i18n.language === 'so'
                ? 'Fadlan ku xidhnow internet-ka si aad wax u iibiso.'
                : 'Please reconnect to the internet to record sales or manage stock.'}
            </span>
          </div>
        )}

        {/* Sticky Top Header Bar */}
        <header className="print:hidden sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200/90 dark:border-slate-800 px-3 py-2 md:px-6 md:py-2.5 space-y-2 shrink-0">
          {/* Top Row: Menu Button & Brand (Mobile) / Branch Scope (Desktop) + Utility Controls */}
          <div className="flex items-center justify-between gap-2">
            {/* Mobile Left: Hamburger Menu Button + Brand Title */}
            <div className="flex md:hidden items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Open Menu"
                className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 active:scale-95 transition shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>
              <img
                src="/baxnaano-logo.jpg"
                alt="Baxnaano"
                className="w-7 h-7 rounded-full object-cover border border-emerald-500/40 shrink-0"
              />
              <span className="font-extrabold text-xs sm:text-sm tracking-tight text-emerald-700 dark:text-emerald-400 truncate">
                BAXNAANO
              </span>
            </div>

            {/* Desktop Left: Branch Scope Selector */}
            <div className="hidden md:flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="hidden lg:inline">Branch Scope:</span>
              </div>

              {user?.role === 'ADMIN' ? (
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setActiveBranchId('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                      activeBranchId === 'ALL'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    All (B1–B3)
                  </button>
                  {Object.values(BAXNAANO_BRANCHES).map((b) => {
                    const isSelected = activeBranchId === b.id || activeBranchId === b.code;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setActiveBranchId(b.id)}
                        title={`${b.code}: ${b.name} (${b.location})`}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                          isSelected
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {b.code} • {b.location}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-800 dark:text-emerald-300 truncate">
                  {activeBranchMeta
                    ? `${activeBranchMeta.code} — ${activeBranchMeta.name} (${activeBranchMeta.location})`
                    : activeBranchId}
                </div>
              )}
            </div>

            {/* Right Controls: Compact & Non-Wrapping on Both Mobile and Desktop */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Live Server Indicator (Single-line, never wraps) */}
              <button
                type="button"
                onClick={checkHealth}
                title={
                  isServerHealthy
                    ? t('sync.server_connected')
                    : t('sync.server_disconnected')
                }
                className={`h-8 sm:h-9 px-2.5 rounded-xl border text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition shrink-0 ${
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
                <span className="hidden sm:inline">
                  {isServerHealthy ? t('sync.online') : t('sync.offline')}
                </span>
                <span className="sm:hidden">
                  {isServerHealthy ? (i18n.language === 'so' ? 'Toos' : 'Live') : 'Offline'}
                </span>
                {isCheckingHealth && (
                  <RefreshCw className="w-3 h-3 animate-spin text-slate-400 shrink-0" />
                )}
              </button>

              {/* Install PWA Button */}
              {!isStandalone && (
                <button
                  type="button"
                  onClick={handleInstallClick}
                  title="Install Baxnaano App directly on your device"
                  className="h-8 sm:h-9 px-2 sm:px-3 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-[11px] sm:text-xs font-bold flex items-center gap-1 whitespace-nowrap transition shadow-xs shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="hidden xs:inline sm:inline">Install</span>
                </button>
              )}

              {/* Language Switcher Button */}
              <button
                type="button"
                onClick={toggleLanguage}
                title="Switch Language (English / Af-Soomaali)"
                className="h-8 sm:h-9 px-2 sm:px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] sm:text-xs font-bold flex items-center gap-1 whitespace-nowrap transition shrink-0"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="sm:hidden">{i18n.language === 'so' ? 'SO' : 'EN'}</span>
                <span className="hidden sm:inline">
                  {i18n.language === 'so' ? 'SO • Soomaali' : 'EN • English'}
                </span>
              </button>

              {/* Dark / Light Mode Toggle */}
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                title="Toggle Light / Dark Theme"
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center transition shrink-0"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-amber-400" />
                ) : (
                  <Moon className="w-4 h-4 text-slate-600" />
                )}
              </button>

              {/* Quick POS Launch Button on Desktop */}
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

          {/* Mobile Second Row: Compact Segmented Branch Bar (Admin Only) */}
          {user?.role === 'ADMIN' && (
            <div className="grid grid-cols-4 md:hidden gap-1 bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl border border-slate-200/70 dark:border-slate-700/80">
              <button
                type="button"
                onClick={() => setActiveBranchId('ALL')}
                className={`py-1 rounded-lg text-[11px] font-bold transition text-center ${
                  activeBranchId === 'ALL'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                All
              </button>
              {Object.values(BAXNAANO_BRANCHES).map((b) => {
                const isSelected = activeBranchId === b.id || activeBranchId === b.code;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveBranchId(b.id)}
                    className={`py-1 rounded-lg text-[11px] font-bold transition text-center ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {b.code}
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* Server Disconnected Warning Banner */}
        {!isServerHealthy && (
          <div className="bg-red-600 text-white px-3 py-1.5 text-xs font-semibold flex items-center justify-between gap-2 shadow-sm shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t('sync.server_disconnected')}</span>
            </div>
            <button
              onClick={checkHealth}
              disabled={isCheckingHealth}
              className="bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded text-[11px] font-bold transition shrink-0 whitespace-nowrap"
            >
              {isCheckingHealth ? '...' : 'Retry'}
            </button>
          </div>
        )}

        {/* Main Page Content */}
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>

      {/* Fixed Bottom Navigation Bar for Mobile Users */}
      <nav className="print:hidden md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-2 py-1 flex items-center justify-around shadow-lg">
        {mobilePrimaryTabs.map((mod) => {
          const cfg = MODULE_ROUTE_CONFIG[mod];
          const Icon = cfg.icon;
          return (
            <NavLink
              key={mod}
              to={cfg.path}
              end={cfg.path === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-1 px-2 rounded-xl min-w-[60px] transition ${
                  isActive
                    ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'text-slate-500 dark:text-slate-400 font-medium'
                }`
              }
            >
              <Icon className="w-4 h-4 mb-0.5" />
              <span className="text-[10px] leading-tight truncate max-w-[68px]">
                {t(`nav.${mod}`)}
              </span>
            </NavLink>
          );
        })}

        {/* Menu Drawer Trigger Tab */}
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl min-w-[60px] transition ${
            isMobileMenuOpen
              ? 'text-emerald-600 dark:text-emerald-400 font-bold'
              : 'text-slate-500 dark:text-slate-400 font-medium'
          }`}
        >
          <Menu className="w-4 h-4 mb-0.5" />
          <span className="text-[10px] leading-tight">
            {i18n.language === 'so' ? 'Menu' : 'Menu'}
          </span>
        </button>
      </nav>
    </div>
  );
};

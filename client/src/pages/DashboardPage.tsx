import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  Calendar,
  CheckSquare,
  Building2,
  Award,
  DollarSign,
  Wallet,
  PieChart,
  ArrowUpRight,
  Clock,
} from 'lucide-react';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import {
  computeOfflineDashboardAnalytics,
  DashboardAnalytics,
} from '../services/reports.offline';

export const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, activeBranchId, setActiveBranchId } = useAuth();

  const [trendRange, setTrendRange] = useState<'7d' | '30d'>('7d');
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);

  useEffect(() => {
    const refresh = () => {
      computeOfflineDashboardAnalytics(activeBranchId).then(setAnalytics);
    };
    refresh();
    window.addEventListener('baxnaano:data-synced', refresh);
    return () => window.removeEventListener('baxnaano:data-synced', refresh);
  }, [activeBranchId]);

  if (!analytics) {
    return (
      <div className="p-6 text-sm text-slate-500">Loading Executive Dashboard...</div>
    );
  }

  const activeTrend = trendRange === '7d' ? analytics.trend7Days : analytics.trend30Days;
  const maxTrendSale = Math.max(10, ...activeTrend.map((d) => d.salesUsd));

  const activeBranchMeta = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === activeBranchId || b.code === activeBranchId
  );

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Compact, Non-Wrapping Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-slate-900 px-5 py-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
            <LayoutDashboard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
              {t('dashboard.title')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {activeBranchId === 'ALL'
                ? 'Consolidated Real-Time Overview • B1 Arabsiyo Pharmacy, B2 Arabsiyo Vet & B3 Gabiley Vet'
                : `${activeBranchMeta?.code} — ${activeBranchMeta?.name} (${activeBranchMeta?.location})`}
            </p>
          </div>
        </div>

        {/* Predictable Single-Row Branch Filter Pills for Admin */}
        {user?.role === 'ADMIN' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveBranchId('ALL')}
              className={`h-9 px-3.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                activeBranchId === 'ALL'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All Branches
            </button>
            {Object.values(BAXNAANO_BRANCHES).map((b) => {
              const isSelected = activeBranchId === b.id || activeBranchId === b.code;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBranchId(b.id)}
                  className={`h-9 px-3.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                    isSelected
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {b.code}: {b.name.replace('Baxnaano ', '')} ({b.location})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Primary Financial KPI Grid (4 Balanced Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Today's Sales */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('dashboard.today_sales')}
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl md:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              ${analytics.kpis.todaySalesUsd.toFixed(2)}
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              Gross: ${analytics.kpis.todayGrossProfitUsd.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Card 2: Today's Expenses */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('dashboard.today_expenses')}
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl md:text-3xl font-extrabold text-amber-600 dark:text-amber-400">
              ${analytics.kpis.todayExpensesUsd.toFixed(2)}
            </div>
            <button
              type="button"
              onClick={() => navigate('/expenses')}
              className="text-[11px] font-semibold text-emerald-600 hover:underline flex items-center gap-0.5"
            >
              Manage <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 3: Today's Net Profit */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('dashboard.today_net_profit')}
            </span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-sky-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-2xl md:text-3xl font-extrabold text-sky-600 dark:text-sky-400">
              ${analytics.kpis.todayNetProfitUsd.toFixed(2)}
            </div>
            <button
              type="button"
              onClick={() => navigate(user?.role === 'VET_OFFICER' ? '/pos' : '/reports')}
              className="text-[11px] font-semibold text-sky-600 hover:underline flex items-center gap-0.5"
            >
              {user?.role === 'VET_OFFICER' ? 'POS' : 'P&L Report'}{' '}
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Card 4: Payment Channel Split */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
              Payment Channels
            </span>
            <PieChart className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">{t('dashboard.cash')}</span>
              <strong className="font-mono font-bold text-emerald-600">
                ${analytics.kpis.todayCashUsd.toFixed(2)}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300 truncate pr-2">
                EVC / Zaad / eDahab
              </span>
              <strong className="font-mono font-bold text-sky-600">
                ${analytics.kpis.todayMobileMoneyUsd.toFixed(2)}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">{t('dashboard.credit')}</span>
              <strong className="font-mono font-bold text-red-600">
                ${analytics.kpis.todayCreditUsd.toFixed(2)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Operational Alerts & Action Strip (4 Scannable Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => navigate('/inventory')}
          className="text-left bg-white dark:bg-slate-900 p-4 rounded-2xl border border-l-4 border-slate-200/90 dark:border-slate-800 border-l-amber-500 shadow-sm hover:shadow transition flex items-center justify-between"
        >
          <div>
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('dashboard.low_stock_items')}
            </div>
            <div className="text-2xl font-extrabold text-amber-600 mt-1">
              {analytics.alerts.lowStockCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/inventory')}
          className="text-left bg-white dark:bg-slate-900 p-4 rounded-2xl border border-l-4 border-slate-200/90 dark:border-slate-800 border-l-red-500 shadow-sm hover:shadow transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {t('dashboard.expiring_30_60_90')}
            </span>
            <Clock className="w-4 h-4 text-red-500 shrink-0" />
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs font-bold">
            <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300">
              30d: {analytics.alerts.expiring30Count}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
              60d: {analytics.alerts.expiring60Count}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300">
              90d: {analytics.alerts.expiring90Count}
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(user?.role === 'VET_OFFICER' ? '/quotations' : '/appointments')}
          className="text-left bg-white dark:bg-slate-900 p-4 rounded-2xl border border-l-4 border-slate-200/90 dark:border-slate-800 border-l-sky-500 shadow-sm hover:shadow transition flex items-center justify-between"
        >
          <div>
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {user?.role === 'VET_OFFICER' ? t('nav.QUOTATIONS') : t('dashboard.today_appointments')}
            </div>
            <div className="text-2xl font-extrabold text-sky-600 mt-1">
              {user?.role === 'VET_OFFICER' ? 'Manage' : analytics.alerts.todayAppointmentsCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-sky-500" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(user?.role === 'VET_OFFICER' ? '/credit' : '/appointments')}
          className="text-left bg-white dark:bg-slate-900 p-4 rounded-2xl border border-l-4 border-slate-200/90 dark:border-slate-800 border-l-purple-500 shadow-sm hover:shadow transition flex items-center justify-between"
        >
          <div>
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {user?.role === 'VET_OFFICER' ? t('nav.CREDIT_RECORDS') : t('dashboard.open_tasks')}
            </div>
            <div className="text-2xl font-extrabold text-purple-600 mt-1">
              {user?.role === 'VET_OFFICER'
                ? `$${analytics.kpis.todayCreditUsd.toFixed(2)}`
                : analytics.alerts.openTasksCount}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/40 flex items-center justify-center">
            <CheckSquare className="w-5 h-5 text-purple-500" />
          </div>
        </button>
      </div>

      {/* Admin Multi-Branch Performance Comparison (B1 vs B2 vs B3) */}
      {user?.role === 'ADMIN' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              {t('dashboard.admin_branch_comparison')}
            </h2>
            <span className="text-xs text-slate-400">Click any branch card to filter scope</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {analytics.branchComparison.map((b) => {
              const isFocused = activeBranchId === b.branchId || activeBranchId === b.code;
              return (
                <div
                  key={b.branchId}
                  onClick={() => setActiveBranchId(b.branchId)}
                  className={`cursor-pointer p-4 rounded-xl border transition space-y-3 ${
                    isFocused
                      ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-emerald-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-extrabold text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-md shrink-0">
                        {b.code}
                      </span>
                      <h3 className="font-bold text-sm truncate">{b.name}</h3>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {b.location}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/70 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-400">Today Sales</div>
                      <div className="font-extrabold text-sm text-emerald-600 mt-0.5">
                        ${b.todaySalesUsd.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t('dashboard.month_sales')}</div>
                      <div className="font-bold text-sm mt-0.5">${b.monthSalesUsd.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">{t('dashboard.month_profit')}</div>
                      <div className="font-bold text-sm text-sky-600 mt-0.5">
                        ${b.monthNetProfitUsd.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Row: Sales Trend Chart (7/30 Days) & Top Selling Products */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              {t('dashboard.sales_trend')}
            </h2>
            <div className="flex gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setTrendRange('7d')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  trendRange === '7d'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {t('dashboard.days_7')}
              </button>
              <button
                type="button"
                onClick={() => setTrendRange('30d')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  trendRange === '30d'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {t('dashboard.days_30')}
              </button>
            </div>
          </div>

          <div className="h-48 flex items-end gap-1.5 pt-6 border-b border-slate-200 dark:border-slate-800">
            {activeTrend.map((pt) => {
              const heightPct = Math.max(4, Math.round((pt.salesUsd / maxTrendSale) * 100));
              return (
                <div
                  key={pt.date}
                  className="flex-1 flex flex-col items-center group relative h-full justify-end"
                >
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-6 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10 pointer-events-none">
                    {pt.date.slice(5)}: ${pt.salesUsd.toFixed(2)}
                  </div>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 rounded-t transition-all"
                  />
                  <span className="text-[9px] text-slate-400 mt-1 truncate">
                    {pt.date.slice(8)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Selling Products */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-600" />
              {t('dashboard.top_selling')}
            </h2>
            <span className="text-xs text-slate-400">By Revenue (USD)</span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {analytics.topSellingItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No sales recorded yet for this branch scope.
              </div>
            ) : (
              analytics.topSellingItems.map((item, idx) => (
                <div
                  key={item.productId}
                  className="flex items-center justify-between py-2.5 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 dark:text-slate-100 truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">{item.sku}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-extrabold text-emerald-600">
                      ${item.revenueUsd.toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-400">{item.quantitySold} sold</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FileBarChart,
  Printer,
  Download,
  FileSpreadsheet,
  Filter,
  RefreshCw,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  Search,
  Layers,
  Users,
  Package,
  Calendar,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { BAXNAANO_BRANCHES, hasPermission } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import {
  reportsApi,
  exportToExcelCsv,
  exportFinancialReportToExcel,
  FullFinancialReportResponse,
  SupplierPayableSummary,
} from '../api';
import { printReportPdf } from '../services/reportPdf';

type ReportTab = 'OVERVIEW' | 'TRANSACTIONS' | 'AR_AP' | 'INVENTORY' | 'ROLLOVER';
type ChartHorizon = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const PRESET_OPTIONS = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This Week' },
  { value: 'LAST_WEEK', label: 'Last Week' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'LAST_MONTH', label: 'Last Month' },
  { value: 'CUSTOM', label: 'Custom Range' },
] as const;

const TX_TYPE_OPTIONS = [
  { value: 'ALL', label: 'All Financial Activities' },
  { value: 'SALE', label: 'POS Cash/Mobile Sales' },
  { value: 'CREDIT_SALE', label: 'POS Credit Sales' },
  { value: 'REFUND', label: 'Returns & Refunds' },
  { value: 'CUSTOMER_PAYMENT', label: 'Customer Credit Collections' },
  { value: 'PURCHASE', label: 'Purchases (Stock-In)' },
  { value: 'SUPPLIER_PAYMENT', label: 'Supplier Payments' },
  { value: 'EXPENSE', label: 'Operating Expenses' },
  { value: 'INVENTORY_ADJUSTMENT', label: 'Inventory Adjustments & Damages' },
  { value: 'BRANCH_TRANSFER', label: 'Inter-Branch Transfers' },
] as const;

const PAYMENT_METHOD_OPTIONS = [
  { value: 'ALL', label: 'All Payment Methods' },
  { value: 'CASH', label: 'Cash (USD / SLSH)' },
  { value: 'EVC_PLUS', label: 'EVC Plus' },
  { value: 'ZAAD', label: 'Zaad Service' },
  { value: 'EDAHAB', label: 'eDahab' },
  { value: 'CREDIT', label: 'Credit (On Account)' },
] as const;

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIAL', label: 'Partial Payment' },
  { value: 'PARTIALLY_REFUNDED', label: 'Partially Refunded' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'VOIDED', label: 'Voided / Cancelled' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

export const ReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, activeBranchId, setActiveBranchId } = useAuth();

  // Initialize filters from URL search params so other modules can deep-link into Reports
  const [preset, setPreset] = useState<string>(
    () => searchParams.get('preset') || 'THIS_MONTH'
  );
  const [fromDate, setFromDate] = useState<string>(() => searchParams.get('fromDate') || '');
  const [toDate, setToDate] = useState<string>(() => searchParams.get('toDate') || '');
  const [transactionType, setTransactionType] = useState<string>(
    () => searchParams.get('type') || 'ALL'
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    () => searchParams.get('method') || 'ALL'
  );
  const [employeeId, setEmployeeId] = useState<string>(
    () => searchParams.get('employeeId') || 'ALL'
  );
  const [statusFilter, setStatusFilter] = useState<string>(
    () => searchParams.get('status') || 'ALL'
  );
  const [searchQuery, setSearchQuery] = useState<string>(
    () => searchParams.get('search') || ''
  );
  const [activeTab, setActiveTab] = useState<ReportTab>(() => {
    const tabParam = (searchParams.get('tab') || '').toUpperCase();
    if (
      tabParam === 'TRANSACTIONS' ||
      tabParam === 'AR_AP' ||
      tabParam === 'INVENTORY' ||
      tabParam === 'ROLLOVER'
    ) {
      return tabParam as ReportTab;
    }
    return searchParams.get('type') ? 'TRANSACTIONS' : 'OVERVIEW';
  });
  const [chartHorizon, setChartHorizon] = useState<ChartHorizon>('DAILY');

  const [report, setReport] = useState<FullFinancialReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Supplier Payment Modal State
  const [payingSupplier, setPayingSupplier] = useState<SupplierPayableSummary | null>(null);
  const [supPayAmount, setSupPayAmount] = useState<string>('');
  const [supPayMethod, setSupPayMethod] = useState<'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB'>('CASH');
  const [supPayNotes, setSupPayNotes] = useState<string>('');
  const [isSubmittingSupPay, setIsSubmittingSupPay] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const canExport = useMemo(
    () => (user ? hasPermission(user.role, 'reports:export') || user.role === 'ADMIN' : false),
    [user]
  );

  const fetchReport = async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const data = await reportsApi.getFinancialReport({
        preset,
        fromDate: preset === 'CUSTOM' ? fromDate : undefined,
        toDate: preset === 'CUSTOM' ? toDate : undefined,
        branchId: activeBranchId,
        transactionType,
        paymentMethod,
        employeeId,
        status: statusFilter,
        search: searchQuery,
      });
      setReport(data);
      if (!fromDate && data.appliedFilters.fromDate) setFromDate(data.appliedFilters.fromDate);
      if (!toDate && data.appliedFilters.toDate) setToDate(data.appliedFilters.toDate);
    } catch (err) {
      console.error('Failed to load financial report:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReport(Boolean(report));
    const timer = setInterval(() => fetchReport(true), 30_000);
    const onFocus = () => fetchReport(true);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [
    activeBranchId,
    preset,
    fromDate,
    toDate,
    transactionType,
    paymentMethod,
    employeeId,
    statusFilter,
    searchQuery,
  ]);

  const handleResetFilters = () => {
    setPreset('THIS_MONTH');
    setTransactionType('ALL');
    setPaymentMethod('ALL');
    setEmployeeId('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
    setSearchParams({});
  };

  const handleVerifyRollover = async () => {
    setIsRefreshing(true);
    try {
      const res = await reportsApi.verifyRollover();
      await fetchReport(true);
      showToast(
        res.closedDays.length > 0
          ? `Midnight rollover closed ${res.closedDays.length} business day(s): ${res.closedDays.join(', ')}`
          : `Africa/Mogadishu business day (${res.currentMogadishuDate}) is up to date. Yesterday (${res.yesterdayMogadishuDate}) is closed.`
      );
    } catch {
      showToast('Failed to verify rollover status.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRecordSupplierPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingSupplier || !supPayAmount || Number(supPayAmount) <= 0) return;
    setIsSubmittingSupPay(true);
    try {
      await reportsApi.recordSupplierPayment({
        supplierId: payingSupplier.id,
        amountOriginal: Number(supPayAmount),
        currency: 'USD',
        exchangeRateUsed: 8500,
        paymentMethod: supPayMethod,
        notes: supPayNotes.trim() || `Supplier payable settlement to ${payingSupplier.name}`,
        branchId: payingSupplier.branchId,
      });
      const paidName = payingSupplier.name;
      setPayingSupplier(null);
      setSupPayAmount('');
      setSupPayNotes('');
      await fetchReport(true);
      showToast(`Recorded $${Number(supPayAmount).toFixed(2)} payment to ${paidName}.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to record supplier payment.');
    } finally {
      setIsSubmittingSupPay(false);
    }
  };

  const handleExportPdf = () => {
    if (!report) return;
    printReportPdf({
      branchId: activeBranchId,
      period: `${report.appliedFilters.preset} (${report.appliedFilters.fromDate} to ${report.appliedFilters.toDate})`,
      financialReport: report,
      generatedBy: user
        ? `${user.fullName || user.username} (${user.role})`
        : 'System Financial Auditor',
    });
  };

  const handleExportExcel = () => {
    if (!report) return;
    exportFinancialReportToExcel(
      `Baxnaano_Financial_Report_${activeBranchId}_${report.appliedFilters.fromDate}_to_${report.appliedFilters.toDate}`,
      report
    );
    showToast('Exported multi-sheet Excel (.xls) financial workbook.');
  };

  const handleExportCsv = () => {
    if (!report) return;
    const rows =
      report.transactions.length > 0
        ? report.transactions.map((tx) => ({
            MogadishuDate: tx.mogadishuDate,
            MogadishuTime: tx.mogadishuTime,
            TransactionType: tx.type,
            ReferenceNumber: tx.referenceNumber,
            Branch: tx.branchCode,
            Party: tx.partyName,
            Employee: tx.employeeName,
            PaymentMethod: tx.paymentMethod,
            Status: tx.status,
            GrossAmountUSD: tx.grossAmountUsd.toFixed(2),
            DiscountUSD: tx.discountUsd.toFixed(2),
            NetAmountUSD: tx.netAmountUsd.toFixed(2),
            CashImpactUSD: tx.cashImpactUsd.toFixed(2),
            RevenueImpactUSD: tx.revenueImpactUsd.toFixed(2),
            ProfitImpactUSD: tx.profitImpactUsd.toFixed(2),
            Description: tx.description,
          }))
        : [
            {
              ReportDate: report.currentMogadishuDate,
              Period: `${report.appliedFilters.fromDate} to ${report.appliedFilters.toDate}`,
              TotalRevenueUSD: report.kpis.totalRevenueUsd.toFixed(2),
              TotalSalesUSD: report.kpis.totalSalesUsd.toFixed(2),
              TotalPurchasesUSD: report.kpis.totalPurchasesUsd.toFixed(2),
              TotalExpensesUSD: report.kpis.totalExpensesUsd.toFixed(2),
              GrossProfitUSD: report.kpis.grossProfitUsd.toFixed(2),
              NetProfitUSD: report.kpis.netProfitUsd.toFixed(2),
              NetCashFlowUSD: report.kpis.netCashFlowUsd.toFixed(2),
              CashBalanceUSD: report.kpis.cashBalanceUsd.toFixed(2),
            },
          ];

    exportToExcelCsv(
      `Baxnaano_Transactions_${activeBranchId}_${report.appliedFilters.fromDate}_to_${report.appliedFilters.toDate}`,
      rows
    );
    showToast('Exported CSV financial ledger.');
  };

  const activeTrendSeries = useMemo(() => {
    if (!report) return [];
    if (chartHorizon === 'DAILY') return report.dailyTrends;
    if (chartHorizon === 'WEEKLY') return report.weeklyTrends;
    return report.monthlyTrends;
  }, [report, chartHorizon]);

  const maxTrendValue = useMemo(() => {
    return Math.max(
      10,
      ...activeTrendSeries.map((pt) =>
        Math.max(pt.revenueUsd, pt.expensesUsd, pt.purchasesUsd, Math.abs(pt.netProfitUsd))
      )
    );
  }, [activeTrendSeries]);

  const txTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'SALE':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
      case 'CREDIT_SALE':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
      case 'CUSTOMER_PAYMENT':
        return 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
      case 'REFUND':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
      case 'PURCHASE':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300';
      case 'SUPPLIER_PAYMENT':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300';
      case 'EXPENSE':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  if (isLoading && !report) {
    return (
      <div className="p-8 text-center text-xs sm:text-sm font-semibold text-slate-500">
        Loading Enterprise Financial Reporting & Accounting Engine...
      </div>
    );
  }

  if (!report) return null;

  const k = report.kpis;
  const comp = report.comparisonWithPreviousPeriod;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-3 sm:p-5 md:p-6 max-w-[1650px] mx-auto space-y-4">
      {toastMsg && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs sm:text-sm font-semibold">
          {toastMsg}
        </div>
      )}

      {/* Top Executive Header, Africa/Mogadishu Business Clock & Export Bar */}
      <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
              <FileBarChart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-xl font-bold tracking-tight">
                  {t('reports.title')} & Central Financial Hub
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                  <Clock className="w-3 h-3" />
                  Africa/Mogadishu (UTC+3): {report.currentMogadishuDate}{' '}
                  {report.currentMogadishuTime.slice(0, 5)}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-Time Consolidated Financial Accounting • Auto Midnight Rollover at 12:00 AM EAT
                • Period: <strong>{report.appliedFilters.fromDate}</strong> to{' '}
                <strong>{report.appliedFilters.toDate}</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => fetchReport(true)}
              className="h-9 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {canExport && (
              <>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="h-9 px-3 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Export PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export Excel (.xls)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="h-9 px-3 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Date Preset Pills + Branch Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreset(opt.value)}
                className={`h-8 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition ${
                  preset === opt.value
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {user?.role === 'ADMIN' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveBranchId('ALL')}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition ${
                  activeBranchId === 'ALL'
                    ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                All Branches (B1-B3)
              </button>
              {Object.values(BAXNAANO_BRANCHES).map((b) => {
                const isSel = activeBranchId === b.id || activeBranchId === b.code;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveBranchId(b.id)}
                    className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition ${
                      isSel
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {b.code} • {b.location}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Multi-Dimensional Filter Grid (Custom Dates, Type, Payment Method, Employee, Status, Search) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2">
          {preset === 'CUSTOM' && (
            <>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  From Date (EAT)
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                  To Date (EAT)
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Transaction Type
            </label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
            >
              {TX_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
            >
              {PAYMENT_METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Employee / Cashier
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
            >
              <option value="ALL">All Employees</option>
              {report.employeesFilterOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.branchCode || 'ADMIN'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Transaction Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className={preset === 'CUSTOM' ? 'sm:col-span-2 lg:col-span-6 flex gap-2' : 'sm:col-span-2 flex gap-2 items-end'}>
            <div className="flex-1">
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                Search Ref #, Customer, Supplier, Payee
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Receipt #, invoice #, customer, supplier, note..."
                  className="w-full h-9 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* 11 Executive Financial KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2.5 sm:gap-3.5 tabular-nums">
        {/* 1. Total Revenue (Net) */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>NET REVENUE</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            ${k.totalRevenueUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
            <span>{comp.previousLabel}: ${comp.previousRevenueUsd.toFixed(2)}</span>
            <span className={comp.revenueChangePct >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
              {comp.revenueChangePct >= 0 ? '+' : ''}{comp.revenueChangePct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* 2. Total Sales (Gross POS) */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>TOTAL SALES ({k.salesCount})</span>
            <TrendingUp className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-1">
            ${k.totalSalesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Refunds: -${k.refundsUsd.toFixed(2)} • Disc: -${k.discountsUsd.toFixed(2)}
          </div>
        </div>

        {/* 3. Gross Profit */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>GROSS PROFIT</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mt-1">
            ${k.grossProfitUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            COGS: ${k.cogsUsd.toFixed(2)} ({k.grossMarginPct.toFixed(1)}% margin)
          </div>
        </div>

        {/* 4. Total Purchases */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>TOTAL PURCHASES ({k.purchasesCount})</span>
            <Package className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
            ${k.totalPurchasesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Supplier Paid: ${k.supplierPaymentsUsd.toFixed(2)}
          </div>
        </div>

        {/* 5. Total Expenses */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>TOTAL EXPENSES</span>
            <TrendingDown className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            ${k.totalExpensesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Pending: ${k.pendingExpensesUsd.toFixed(2)} • Shrink: ${k.inventoryShrinkageUsd.toFixed(2)}
          </div>
        </div>

        {/* 6. Net Profit */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>NET PROFIT</span>
            <ShieldCheck className="w-4 h-4 text-sky-600" />
          </div>
          <div
            className={`text-lg sm:text-xl font-bold mt-1 ${
              k.netProfitUsd >= 0 ? 'text-sky-600 dark:text-sky-400' : 'text-rose-600'
            }`}
          >
            ${k.netProfitUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Net Margin: {k.netMarginPct.toFixed(1)}% ({comp.previousLabel}: ${comp.previousNetProfitUsd.toFixed(2)})
          </div>
        </div>
      </div>

      {/* Second Row of KPIs: Cash Balance, Cash Flow, Credit Sales, Customer Collections, Receivables, Payables */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3.5 tabular-nums">
        {/* 7. Cash Balance (On Hand) */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>CASH BALANCE</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-emerald-600 mt-1">
            ${k.cashBalanceUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Cash + EVC + Zaad + eDahab
          </div>
        </div>

        {/* 8. Period Net Cash Flow */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>NET CASH FLOW</span>
            {k.netCashFlowUsd >= 0 ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-rose-600" />
            )}
          </div>
          <div
            className={`text-lg sm:text-xl font-bold mt-1 ${
              k.netCashFlowUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {k.netCashFlowUsd >= 0 ? '+' : ''}${k.netCashFlowUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            In: +${k.cashInflowUsd.toFixed(2)} | Out: -${k.cashOutflowUsd.toFixed(2)}
          </div>
        </div>

        {/* 9. Credit Sales (Excluded from Cash Received) */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>CREDIT SALES</span>
            <CreditCard className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-amber-600 mt-1">
            ${k.creditSalesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Booked to A/R (Not counted as cash)
          </div>
        </div>

        {/* Customer Credit Collections (Excluded from Sales Revenue) */}
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>DEBT COLLECTIONS</span>
            <CheckCircle2 className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-sky-600 mt-1">
            +${k.customerPaymentsUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Cash Inflow (Not double-counted in sales)
          </div>
        </div>

        {/* 10. Outstanding Receivables (A/R) */}
        <div
          onClick={() => setActiveTab('AR_AP')}
          className="cursor-pointer bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:border-rose-400 shadow-xs transition"
        >
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>RECEIVABLES (A/R)</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-rose-600 mt-1">
            ${k.outstandingReceivablesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {report.receivablesCustomers.length} active customer debtor(s)
          </div>
        </div>

        {/* 11. Outstanding Payables (A/P) */}
        <div
          onClick={() => setActiveTab('AR_AP')}
          className="cursor-pointer bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 hover:border-purple-400 shadow-xs transition"
        >
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>PAYABLES (A/P)</span>
            <Building2 className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-lg sm:text-xl font-bold text-purple-600 mt-1">
            ${k.outstandingPayablesUsd.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Owed to suppliers • Tap to settle
          </div>
        </div>
      </div>

      {/* Section Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
        {[
          { id: 'OVERVIEW', label: 'Financial Overview & Charts', icon: TrendingUp },
          {
            id: 'TRANSACTIONS',
            label: `Unified Transactions Ledger (${report.transactions.length})`,
            icon: Layers,
          },
          {
            id: 'AR_AP',
            label: `Receivables & Payables (A/R & A/P)`,
            icon: CreditCard,
          },
          { id: 'INVENTORY', label: 'Stock Valuation & Movers', icon: Package },
          {
            id: 'ROLLOVER',
            label: `Midnight Rollover History (${report.rolloverHistory.length})`,
            icon: Clock,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as ReportTab)}
              className={`h-9 px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                active
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: FINANCIAL OVERVIEW, P&L, CASH FLOW, CHARTS, BRANCHES & STAFF */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-4">
          {/* Income Statement (P&L) + Cash Flow & Payment Channel Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 tabular-nums">
            {/* Income Statement */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600" />
                  <span>Income Statement (Profit & Loss)</span>
                </h2>
                <span className="text-[11px] text-slate-400">
                  {report.appliedFilters.fromDate} → {report.appliedFilters.toDate}
                </span>
              </div>
              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Gross POS Sales ({k.salesCount} completed):</span>
                  <span className="font-semibold">${k.totalSalesUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Discounts Applied:</span>
                  <span className="text-amber-600">-${k.discountsUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Customer Returns & Refunds:</span>
                  <span className="text-rose-600">-${k.refundsUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 font-bold text-emerald-600">
                  <span>Net Sales Revenue:</span>
                  <span>${k.totalRevenueUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Cost of Goods Sold (FEFO Batch Cost):</span>
                  <span className="text-rose-600">-${k.cogsUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 font-bold">
                  <span>Gross Profit ({k.grossMarginPct.toFixed(1)}%):</span>
                  <span>${k.grossProfitUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Approved Operating Expenses:</span>
                  <span className="text-amber-600">-${k.totalExpensesUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t-2 border-slate-200 dark:border-slate-700 text-sm sm:text-base font-bold">
                  <span>Net Profit ({k.netMarginPct.toFixed(1)}%):</span>
                  <span className={k.netProfitUsd >= 0 ? 'text-sky-600' : 'text-rose-600'}>
                    ${k.netProfitUsd.toFixed(2)}
                  </span>
                </div>
                {k.voidedCount > 0 && (
                  <div className="text-[11px] text-slate-400 pt-1">
                    * Excluded {k.voidedCount} voided/cancelled sale(s) totaling ${k.voidedSalesUsd.toFixed(2)} from financial totals.
                  </div>
                )}
              </div>
            </div>

            {/* Cash Management & Cash Flow Statement */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span>Cash Flow & Payment Channels</span>
                </h2>
                <span className="text-[11px] text-emerald-600 font-semibold">
                  On-Hand Balance: ${k.cashBalanceUsd.toFixed(2)}
                </span>
              </div>
              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">POS Cash & Mobile Money Collected (Net):</span>
                  <span className="font-semibold text-emerald-600">
                    +${k.posCashCollectedUsd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer Credit Collections (A/R Repayments):</span>
                  <span className="font-semibold text-sky-600">
                    +${k.customerPaymentsUsd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 font-bold text-emerald-600">
                  <span>Total Period Cash Inflow:</span>
                  <span>+${k.cashInflowUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Payments to Suppliers (Purchases & A/P):</span>
                  <span className="text-rose-600">-${k.supplierPaymentsUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Less: Approved Operating Expenses Paid:</span>
                  <span className="text-rose-600">-${k.totalExpensesUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 font-bold">
                  <span>Total Period Cash Outflow:</span>
                  <span className="text-rose-600">-${k.cashOutflowUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t-2 border-slate-200 dark:border-slate-700 text-sm sm:text-base font-bold">
                  <span>Net Period Cash Flow:</span>
                  <span className={k.netCashFlowUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    {k.netCashFlowUsd >= 0 ? '+' : ''}${k.netCashFlowUsd.toFixed(2)}
                  </span>
                </div>

                {/* Method Split Pills */}
                <div className="grid grid-cols-4 gap-2 pt-2">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-center">
                    <div className="text-[10px] text-slate-400">CASH</div>
                    <div className="font-bold text-xs mt-0.5">${k.cashByMethod.CASH.toFixed(2)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-center">
                    <div className="text-[10px] text-slate-400">EVC PLUS</div>
                    <div className="font-bold text-xs mt-0.5">${k.cashByMethod.EVC_PLUS.toFixed(2)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-center">
                    <div className="text-[10px] text-slate-400">ZAAD</div>
                    <div className="font-bold text-xs mt-0.5">${k.cashByMethod.ZAAD.toFixed(2)}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-center">
                    <div className="text-[10px] text-slate-400">eDAHAB</div>
                    <div className="font-bold text-xs mt-0.5">${k.cashByMethod.EDAHAB.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Daily / Weekly / Monthly Financial Trend Chart */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span>Automated Daily, Weekly & Monthly Financial Analytics</span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Comparing Net Revenue (Emerald), Operating Expenses (Amber), and Net Profit (Sky)
                </p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start">
                {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setChartHorizon(h)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      chartHorizon === h
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {h === 'DAILY' ? 'Daily (14d)' : h === 'WEEKLY' ? 'Weekly (8w)' : 'Monthly (6m)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-52 flex items-end gap-1.5 sm:gap-3 pt-8 pb-2 px-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
              {activeTrendSeries.map((pt) => {
                const revH = Math.max(4, Math.round((pt.revenueUsd / maxTrendValue) * 100));
                const expH = Math.max(2, Math.round((pt.expensesUsd / maxTrendValue) * 100));
                const profH = Math.max(
                  3,
                  Math.round((Math.max(0, pt.netProfitUsd) / maxTrendValue) * 100)
                );
                return (
                  <div
                    key={pt.date}
                    className="flex-1 min-w-[42px] flex flex-col items-center group relative h-full justify-end"
                  >
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-7 bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap z-20 pointer-events-none">
                      {pt.label}: Rev ${pt.revenueUsd.toFixed(0)} | Exp ${pt.expensesUsd.toFixed(0)} | Net ${pt.netProfitUsd.toFixed(0)}
                    </div>
                    <div className="w-full flex items-end justify-center gap-0.5 h-full">
                      <div
                        style={{ height: `${revH}%` }}
                        className="w-1/3 bg-emerald-500 rounded-t"
                        title={`Revenue: $${pt.revenueUsd.toFixed(2)}`}
                      />
                      <div
                        style={{ height: `${expH}%` }}
                        className="w-1/3 bg-amber-500 rounded-t"
                        title={`Expenses: $${pt.expensesUsd.toFixed(2)}`}
                      />
                      <div
                        style={{ height: `${profH}%` }}
                        className="w-1/3 bg-sky-500 rounded-t"
                        title={`Net Profit: $${pt.netProfitUsd.toFixed(2)}`}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1.5 font-mono truncate">
                      {pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Multi-Branch Financial Comparison Table (B1, B2, B3) */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <span>Three-Branch Financial Breakdown (B1 Pharmacy, B2 Vet, B3 Vet)</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left tabular-nums">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="p-2.5">Branch</th>
                    <th className="p-2.5 text-right">Net Revenue</th>
                    <th className="p-2.5 text-right">Purchases</th>
                    <th className="p-2.5 text-right">Expenses</th>
                    <th className="p-2.5 text-right">Gross Profit</th>
                    <th className="p-2.5 text-right">Net Profit</th>
                    <th className="p-2.5 text-right">Cash Flow</th>
                    <th className="p-2.5 text-right">Credit Sales</th>
                    <th className="p-2.5 text-right">Collections</th>
                    <th className="p-2.5 text-right">A/R Due</th>
                    <th className="p-2.5 text-right">A/P Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.branchSummaries.map((b) => (
                    <tr key={b.branchId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="p-2.5 font-semibold">
                        <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-600 text-white font-mono text-[10px] mr-1.5">
                          {b.code}
                        </span>
                        {b.name} ({b.location})
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-600">
                        ${b.revenueUsd.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right">${b.purchasesUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right text-amber-600">${b.expensesUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right font-semibold">${b.grossProfitUsd.toFixed(2)}</td>
                      <td
                        className={`p-2.5 text-right font-bold ${
                          b.netProfitUsd >= 0 ? 'text-sky-600' : 'text-rose-600'
                        }`}
                      >
                        ${b.netProfitUsd.toFixed(2)}
                      </td>
                      <td
                        className={`p-2.5 text-right font-semibold ${
                          b.netCashFlowUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {b.netCashFlowUsd >= 0 ? '+' : ''}${b.netCashFlowUsd.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right text-amber-600">${b.creditSalesUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right text-sky-600">${b.customerPaymentsUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right font-semibold text-rose-600">
                        ${b.receivablesUsd.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right font-semibold text-purple-600">
                        ${b.payablesUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Employee / Cashier Financial Performance */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              <span>Employee & Cashier Financial Accountability</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left tabular-nums">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="p-2.5">Employee / Cashier</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5">Branch</th>
                    <th className="p-2.5 text-right">Sales Count</th>
                    <th className="p-2.5 text-right">Net Revenue</th>
                    <th className="p-2.5 text-right">POS Cash Collected</th>
                    <th className="p-2.5 text-right">Credit Sales Issued</th>
                    <th className="p-2.5 text-right">Expenses Logged</th>
                    <th className="p-2.5 text-right">Filter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.staffPerformance.map((st) => (
                    <tr key={st.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="p-2.5 font-semibold">{st.fullName}</td>
                      <td className="p-2.5 text-slate-500">{st.role}</td>
                      <td className="p-2.5 font-mono">{st.branchCode}</td>
                      <td className="p-2.5 text-right">{st.salesCount}</td>
                      <td className="p-2.5 text-right font-bold text-emerald-600">
                        ${st.netRevenueUsd.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right">${st.cashCollectedUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right text-amber-600">${st.creditSalesUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right text-rose-600">${st.expensesRecordedUsd.toFixed(2)}</td>
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEmployeeId(st.employeeId);
                            setActiveTab('TRANSACTIONS');
                          }}
                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white text-[11px] font-semibold transition"
                        >
                          Audit Ledger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: UNIFIED FINANCIAL TRANSACTIONS LEDGER */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-sm sm:text-base">
                Unified Financial Transactions Ledger ({report.transactions.length} records)
              </h2>
              <p className="text-[11px] text-slate-400">
                Real-time stream of POS Sales, Credit Sales, Refunds, Customer Collections,
                Purchases, Supplier Payments, Expenses & Inventory Adjustments
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left tabular-nums">
              <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="p-2.5">Date & Time (EAT)</th>
                  <th className="p-2.5">Activity Type</th>
                  <th className="p-2.5">Reference #</th>
                  <th className="p-2.5">Branch</th>
                  <th className="p-2.5">Customer / Supplier / Payee</th>
                  <th className="p-2.5">Employee</th>
                  <th className="p-2.5">Method</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5 text-right">Net Amount</th>
                  <th className="p-2.5 text-right">Cash Impact</th>
                  <th className="p-2.5 text-right">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.transactions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-400">
                      No financial transactions match the selected filters for this period.
                    </td>
                  </tr>
                ) : (
                  report.transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        tx.isExcludedFromTotals ? 'opacity-65' : ''
                      }`}
                    >
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-semibold">{tx.mogadishuDate}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{tx.mogadishuTime}</div>
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${txTypeBadgeClass(
                            tx.type
                          )}`}
                        >
                          {tx.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono font-semibold">{tx.referenceNumber}</td>
                      <td className="p-2.5 font-mono">{tx.branchCode}</td>
                      <td className="p-2.5">
                        <div className="font-semibold">{tx.partyName}</div>
                        <div className="text-[11px] text-slate-400 max-w-xs truncate" title={tx.description}>
                          {tx.description}
                        </div>
                      </td>
                      <td className="p-2.5">{tx.employeeName}</td>
                      <td className="p-2.5 font-mono text-[11px]">{tx.paymentMethod}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            tx.status === 'VOIDED' || tx.status === 'REJECTED'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                              : tx.status === 'PENDING' || tx.status === 'PARTIAL'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-bold">
                        ${tx.netAmountUsd.toFixed(2)}
                      </td>
                      <td
                        className={`p-2.5 text-right font-bold ${
                          tx.cashImpactUsd > 0
                            ? 'text-emerald-600'
                            : tx.cashImpactUsd < 0
                            ? 'text-rose-600'
                            : 'text-slate-400'
                        }`}
                      >
                        {tx.cashImpactUsd > 0 ? '+' : ''}
                        ${tx.cashImpactUsd.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => navigate(tx.sourceModule)}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:underline text-[11px] font-semibold"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ACCOUNTS RECEIVABLE (CUSTOMERS) & ACCOUNTS PAYABLE (SUPPLIERS) */}
      {activeTab === 'AR_AP' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 tabular-nums">
          {/* Accounts Receivable (Customers) */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm sm:text-base">
                  Accounts Receivable — Customer Credit Aging
                </h2>
                <p className="text-[11px] text-slate-400">
                  Total Recoverable Debt: <strong>${k.outstandingReceivablesUsd.toFixed(2)}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/credit')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                Collect Repayment →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2.5">Customer</th>
                    <th className="p-2.5">Branch</th>
                    <th className="p-2.5 text-right">0-30d</th>
                    <th className="p-2.5 text-right">31-60d</th>
                    <th className="p-2.5 text-right">60+d</th>
                    <th className="p-2.5 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.receivablesCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-400">
                        No outstanding customer receivables.
                      </td>
                    </tr>
                  ) : (
                    report.receivablesCustomers.map((c) => (
                      <tr key={c.id}>
                        <td className="p-2.5 font-semibold">
                          <div>{c.name}</div>
                          <div className="text-[10px] text-slate-400">{c.phone}</div>
                        </td>
                        <td className="p-2.5 font-mono">{c.branchCode}</td>
                        <td className="p-2.5 text-right">${c.aging.bucket0to30Usd.toFixed(2)}</td>
                        <td className="p-2.5 text-right">${c.aging.bucket31to60Usd.toFixed(2)}</td>
                        <td className="p-2.5 text-right text-rose-600 font-bold">
                          ${c.aging.bucket60PlusUsd.toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right font-bold text-rose-600">
                          ${c.currentBalanceUsd.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Accounts Payable (Suppliers) */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm sm:text-base">
                  Accounts Payable — Supplier Balances & Settlements
                </h2>
                <p className="text-[11px] text-slate-400">
                  Total Supplier Payables: <strong>${k.outstandingPayablesUsd.toFixed(2)}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/inventory')}
                className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:bg-slate-200"
              >
                Stock-In Purchases →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2.5">Supplier</th>
                    <th className="p-2.5">Branch</th>
                    <th className="p-2.5 text-right">Total Purchased</th>
                    <th className="p-2.5 text-right">Total Paid</th>
                    <th className="p-2.5 text-right">Payable Due</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.payablesSuppliers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-400">
                        No suppliers registered in this branch scope.
                      </td>
                    </tr>
                  ) : (
                    report.payablesSuppliers.map((sup) => (
                      <tr key={sup.id}>
                        <td className="p-2.5 font-semibold">
                          <div>{sup.name}</div>
                          <div className="text-[10px] text-slate-400">{sup.phone}</div>
                        </td>
                        <td className="p-2.5 font-mono">{sup.branchCode}</td>
                        <td className="p-2.5 text-right">${sup.totalPurchasedUsd.toFixed(2)}</td>
                        <td className="p-2.5 text-right text-emerald-600">
                          ${sup.totalPaidUsd.toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right font-bold text-purple-600">
                          ${sup.balanceUsd.toFixed(2)}
                        </td>
                        <td className="p-2.5 text-right">
                          {sup.balanceUsd > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingSupplier(sup);
                                setSupPayAmount(sup.balanceUsd.toFixed(2));
                              }}
                              className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold"
                            >
                              Pay Supplier
                            </button>
                          ) : (
                            <span className="text-[11px] text-emerald-600 font-semibold">
                              Settled
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: INVENTORY VALUATION & FAST/SLOW MOVERS */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4 tabular-nums">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-400">FEFO Sellable Cost Value (Buy)</div>
              <div className="text-xl font-bold mt-1">
                ${report.stockValuation.totalCostValuationUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {report.stockValuation.totalSellableUnits} sellable units
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-400">FEFO Retail Value (Sell)</div>
              <div className="text-xl font-bold text-emerald-600 mt-1">
                ${report.stockValuation.totalRetailValuationUsd.toFixed(2)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-400">Projected Gross Margin</div>
              <div className="text-xl font-bold text-sky-600 mt-1">
                ${report.stockValuation.projectedMarginUsd.toFixed(2)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-400">Quarantined Expired Stock Value</div>
              <div className="text-xl font-bold text-rose-600 mt-1">
                ${report.stockValuation.expiredValuationUsd.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {report.stockValuation.totalExpiredUnits} expired units blocked from POS
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
              <h3 className="font-bold text-sm">Fast-Moving Products (In Period)</h3>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2 text-right">Qty Sold</th>
                    <th className="p-2 text-right">Revenue</th>
                    <th className="p-2 text-right">Current Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.fastMovers.map((m: any) => (
                    <tr key={m.productId}>
                      <td className="p-2 font-semibold">
                        {m.name} <span className="text-[10px] text-slate-400 font-mono">({m.sku})</span>
                      </td>
                      <td className="p-2 text-right font-bold text-emerald-600">
                        {m.quantitySoldInPeriod}
                      </td>
                      <td className="p-2 text-right">${Number(m.revenueUsd || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{m.stockQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
              <h3 className="font-bold text-sm">Slow-Moving Stocked Products</h3>
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2 text-right">Qty Sold</th>
                    <th className="p-2 text-right">Stock Qty</th>
                    <th className="p-2 text-right">Cost Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.slowMovers.map((m: any) => (
                    <tr key={m.productId}>
                      <td className="p-2 font-semibold">
                        {m.name} <span className="text-[10px] text-slate-400 font-mono">({m.sku})</span>
                      </td>
                      <td className="p-2 text-right">{m.quantitySoldInPeriod}</td>
                      <td className="p-2 text-right font-semibold">{m.stockQty}</td>
                      <td className="p-2 text-right font-bold">${Number(m.costValuationUsd || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUTOMATIC MIDNIGHT ROLLOVER (AFRICA/MOGADISHU UTC+3) */}
      {activeTab === 'ROLLOVER' && (
        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-sm sm:text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                <span>Automated Midnight Rollover Archive (Africa/Mogadishu UTC+3)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every day at 12:00 AM EAT, the previous business day is automatically closed and
                archived while preserving all underlying transaction records.
              </p>
            </div>
            <button
              type="button"
              onClick={handleVerifyRollover}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 self-start"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Verify Midnight Rollover Now</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left tabular-nums">
              <thead className="bg-slate-100 dark:bg-slate-800">
                <tr>
                  <th className="p-2.5">Business Date (EAT)</th>
                  <th className="p-2.5">Branch Scope</th>
                  <th className="p-2.5 text-right">Net Revenue</th>
                  <th className="p-2.5 text-right">Purchases</th>
                  <th className="p-2.5 text-right">Expenses</th>
                  <th className="p-2.5 text-right">Gross Profit</th>
                  <th className="p-2.5 text-right">Net Profit</th>
                  <th className="p-2.5 text-right">Net Cash Flow</th>
                  <th className="p-2.5">Closed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.rolloverHistory.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="p-2.5 font-mono font-bold">{r.businessDate}</td>
                    <td className="p-2.5 font-mono">
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                        {r.branchCode}
                      </span>
                    </td>
                    <td className="p-2.5 text-right font-bold text-emerald-600">
                      ${r.totalRevenueUsd.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right">${r.totalPurchasesUsd.toFixed(2)}</td>
                    <td className="p-2.5 text-right text-amber-600">
                      ${r.totalExpensesUsd.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right">${r.grossProfitUsd.toFixed(2)}</td>
                    <td className="p-2.5 text-right font-bold text-sky-600">
                      ${r.netProfitUsd.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right font-semibold">
                      ${r.netCashFlowUsd.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-slate-400">
                      {new Date(r.closedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record Supplier Payment Modal */}
      {payingSupplier && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordSupplierPayment}
            className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Record Supplier Payment (A/P)</h3>
              <button
                type="button"
                onClick={() => setPayingSupplier(null)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Supplier:</span>
                <strong>{payingSupplier.name}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Payable Balance:</span>
                <strong className="text-purple-600">${payingSupplier.balanceUsd.toFixed(2)}</strong>
              </div>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Amount Paid (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={payingSupplier.balanceUsd}
                  required
                  value={supPayAmount}
                  onChange={(e) => setSupPayAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Payment Method</label>
                <select
                  value={supPayMethod}
                  onChange={(e) => setSupPayMethod(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  <option value="CASH">Cash (USD)</option>
                  <option value="EVC_PLUS">EVC Plus</option>
                  <option value="ZAAD">Zaad Service</option>
                  <option value="EDAHAB">eDahab</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Payment Reference / Notes</label>
                <input
                  type="text"
                  value={supPayNotes}
                  onChange={(e) => setSupPayNotes(e.target.value)}
                  placeholder="Invoice # or payment voucher reference..."
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingSupplier(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingSupPay}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
              >
                {isSubmittingSupPay ? 'Recording...' : 'Confirm Supplier Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

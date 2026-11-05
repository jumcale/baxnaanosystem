import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CreditCard,
  UserPlus,
  DollarSign,
  Printer,
  AlertTriangle,
  Search,
  FileBarChart,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { creditApi, settingsApi, CustomerAging } from '../api';
import { NumericInput } from '../components/NumericInput';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { printStatementPdf } from '../services/statementPdf';

export const CreditRecordsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, activeBranchId, canPerform, canViewModule } = useAuth();

  const [customers, setCustomers] = useState<CustomerAging[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [selectedForPayment, setSelectedForPayment] = useState<CustomerAging | null>(null);
  const [statementCustomer, setStatementCustomer] = useState<CustomerAging | null>(null);

  const [newCustomer, setNewCustomer] = useState({
    branchId: activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId,
    name: '',
    phone: '',
    villageOrFarm: '',
    creditLimitUsd: 100,
  });

  const [repaymentForm, setRepaymentForm] = useState({
    method: 'CASH' as 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB',
    currency: 'USD' as 'USD' | 'SLSH',
    amountOriginal: 0,
    exchangeRateUsed: 10000,
    referencePhone: '',
    notes: '',
  });

  const loadCreditData = async () => {
    try {
      const list = await creditApi.getCustomers(activeBranchId);
      setCustomers(list);
    } catch (err) {
      console.error('Failed to load customers:', err);
    }
  };

  useEffect(() => {
    loadCreditData();
    settingsApi.getBranches().then((branches) => {
      const b = branches.find((item) => item.id === activeBranchId || item.code === activeBranchId);
      if (b?.exchangeRate) {
        setRepaymentForm((prev) => ({ ...prev, exchangeRateUsed: b.exchangeRate }));
      }
    });

    if (activeBranchId !== 'ALL') {
      setNewCustomer((prev) => ({ ...prev, branchId: activeBranchId }));
    }

    const onFocus = () => loadCreditData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeBranchId]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        String(c.name).toLowerCase().includes(q) ||
        String(c.phone).toLowerCase().includes(q) ||
        String(c.villageOrFarm || '').toLowerCase().includes(q)
    );
  }, [customers, searchQuery]);

  const totals = useMemo(() => {
    return filteredCustomers.reduce(
      (acc, c) => {
        acc.totalDue += c.currentBalanceUsd;
        acc.b0_30 += c.aging.bucket0to30Usd;
        acc.b31_60 += c.aging.bucket31to60Usd;
        acc.b60_plus += c.aging.bucket60PlusUsd;
        return acc;
      },
      { totalDue: 0, b0_30: 0, b31_60: 0, b60_plus: 0 }
    );
  }, [filteredCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetBranch =
      user?.branchId ||
      (activeBranchId === 'ALL'
        ? newCustomer.branchId || BAXNAANO_BRANCHES.B1.id
        : activeBranchId);

    try {
      await creditApi.createCustomer({
        branchId: targetBranch,
        name: newCustomer.name,
        phone: newCustomer.phone,
        villageOrFarm: newCustomer.villageOrFarm,
        creditLimitUsd: Number(newCustomer.creditLimitUsd),
      });

      setShowAddCustomer(false);
      setNewCustomer({
        branchId: activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId,
        name: '',
        phone: '',
        villageOrFarm: '',
        creditLimitUsd: 100,
      });
      await loadCreditData();
    } catch (err: any) {
      alert(err?.message || 'Failed to create customer on server.');
    }
  };

  const handleRecordRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForPayment || !user) return;
    const targetBranch =
      selectedForPayment.branchId ||
      user?.branchId ||
      (activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId);

    try {
      await creditApi.recordRepayment({
        branchId: targetBranch,
        customerId: selectedForPayment.id,
        method: repaymentForm.method,
        currency: repaymentForm.currency,
        amountOriginal: Number(repaymentForm.amountOriginal),
        exchangeRateUsed: Number(repaymentForm.exchangeRateUsed),
        referencePhone: repaymentForm.referencePhone,
        notes: repaymentForm.notes,
      });

      setSelectedForPayment(null);
      await loadCreditData();
    } catch (err: any) {
      alert(err?.message || 'Failed to record credit repayment.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2 min-w-0">
          <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 shrink-0" />
          <span className="truncate">{t('credit.title')}</span>
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          {canViewModule('REPORTS') && (
            <button
              type="button"
              onClick={() => navigate('/reports?tab=AR_AP')}
              className="min-h-[40px] px-3 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition"
            >
              <FileBarChart className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">A/R Financial Report</span>
            </button>
          )}
          <button
            onClick={() => setShowAddCustomer(true)}
            className="min-h-[40px] px-3.5 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 shadow-sm shrink-0 transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>{t('credit.add_customer')}</span>
          </button>
        </div>
      </div>

      {/* Aging Summary Cards (2x2 Grid on Mobile, 4 Columns on Desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 tabular-nums">
        <div className="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
          <div className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">
            {t('credit.fields.current_balance')}
          </div>
          <div className="text-lg sm:text-2xl font-bold mt-1">${totals.totalDue.toFixed(2)}</div>
        </div>
        <div className="bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-emerald-200 dark:border-emerald-800">
          <div className="text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-300 font-semibold truncate">
            {t('credit.fields.bucket_0_30')}
          </div>
          <div className="text-lg sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
            ${totals.b0_30.toFixed(2)}
          </div>
        </div>
        <div className="bg-amber-50/70 dark:bg-amber-950/20 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-amber-200 dark:border-amber-800">
          <div className="text-[11px] sm:text-xs text-amber-700 dark:text-amber-300 font-semibold truncate">
            {t('credit.fields.bucket_31_60')}
          </div>
          <div className="text-lg sm:text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">
            ${totals.b31_60.toFixed(2)}
          </div>
        </div>
        <div className="bg-red-50/70 dark:bg-red-950/20 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-red-200 dark:border-red-800">
          <div className="text-[11px] sm:text-xs text-red-700 dark:text-red-300 font-semibold truncate">
            {t('credit.fields.bucket_60_plus')}
          </div>
          <div className="text-lg sm:text-2xl font-bold text-red-600 mt-1">
            ${totals.b60_plus.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 sm:w-5 sm:h-5 absolute left-3.5 top-3 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`${t('credit.fields.name')}, ${t('credit.fields.phone')}, ${t(
            'credit.fields.village_or_farm'
          )}...`}
          className="w-full min-h-[42px] pl-10 pr-4 py-2 text-xs sm:text-sm rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
        />
      </div>

      {/* Customer Ledger Cards */}
      <div className="space-y-2.5 sm:space-y-3">
        {filteredCustomers.map((c) => (
          <div
            key={c.id}
            className="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                  {String(c.name)}
                </h3>
                <span className="text-[11px] font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                  {String(c.phone)}
                </span>
                {c.villageOrFarm && (
                  <span className="text-xs text-slate-500">({String(c.villageOrFarm)})</span>
                )}
                {c.aging.isOverdue && (
                  <span className="text-[11px] bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('credit.overdue_alert')}
                  </span>
                )}
                {c.isOverLimit && (
                  <span className="text-[11px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                    {t('credit.over_limit')}
                  </span>
                )}
              </div>

              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-3 tabular-nums">
                <span>
                  {t('credit.fields.credit_limit')}: <strong>${c.creditLimitUsd.toFixed(2)}</strong>
                </span>
                <span>0-30d: ${c.aging.bucket0to30Usd.toFixed(2)}</span>
                <span>31-60d: ${c.aging.bucket31to60Usd.toFixed(2)}</span>
                <span className="text-red-600 font-semibold">
                  60+d: ${c.aging.bucket60PlusUsd.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-700/60">
              <div className="text-left md:text-right mr-1 tabular-nums">
                <div className="text-[10px] text-slate-400">{t('credit.fields.current_balance')}</div>
                <div className="text-base sm:text-lg font-bold text-red-600">
                  ${c.currentBalanceUsd.toFixed(2)}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {canPerform('credit:payment') && c.currentBalanceUsd > 0 && (
                  <button
                    onClick={() => {
                      setSelectedForPayment(c);
                      setRepaymentForm((prev) => ({
                        ...prev,
                        amountOriginal: c.currentBalanceUsd,
                      }));
                    }}
                    className="min-h-[38px] px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>{t('credit.record_repayment')}</span>
                  </button>
                )}

                <button
                  onClick={() => setStatementCustomer(c)}
                  className="min-h-[38px] px-2.5 sm:px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t('credit.print_statement')}</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomer}
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl max-w-md w-full space-y-3.5 shadow-2xl"
          >
            <h2 className="text-base sm:text-lg font-bold">{t('credit.add_customer')}</h2>
            <input
              required
              placeholder={t('credit.fields.name')}
              value={newCustomer.name}
              onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
            />
            <input
              required
              placeholder={t('credit.fields.phone')}
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
            />
            <input
              placeholder={t('credit.fields.village_or_farm')}
              value={newCustomer.villageOrFarm}
              onChange={(e) => setNewCustomer({ ...newCustomer, villageOrFarm: e.target.value })}
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
            />
            <div>
              <label className="block text-xs font-semibold mb-1">
                {t('credit.fields.credit_limit')}
              </label>
              <NumericInput
                min={0}
                value={newCustomer.creditLimitUsd}
                onChange={(val) =>
                  setNewCustomer({ ...newCustomer, creditLimitUsd: val })
                }
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-5 py-2 text-xs sm:text-sm bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Repayment Modal */}
      {selectedForPayment && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordRepayment}
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl max-w-md w-full space-y-3.5 shadow-2xl"
          >
            <h2 className="text-base sm:text-lg font-bold">
              {t('credit.record_repayment')} - {String(selectedForPayment.name)}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={repaymentForm.method}
                onChange={(e) =>
                  setRepaymentForm({
                    ...repaymentForm,
                    method: e.target.value as typeof repaymentForm.method,
                  })
                }
                className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              >
                <option value="CASH">Cash</option>
                <option value="EVC_PLUS">EVC Plus</option>
                <option value="ZAAD">Zaad</option>
                <option value="EDAHAB">eDahab</option>
              </select>
              <select
                value={repaymentForm.currency}
                onChange={(e) => {
                  const nextCurr = e.target.value as 'USD' | 'SLSH';
                  const rate = repaymentForm.exchangeRateUsed || 8500;
                  const nextAmt =
                    nextCurr === 'SLSH' && repaymentForm.currency === 'USD'
                      ? Math.round(repaymentForm.amountOriginal * rate)
                      : nextCurr === 'USD' && repaymentForm.currency === 'SLSH'
                      ? Number((repaymentForm.amountOriginal / rate).toFixed(2))
                      : repaymentForm.amountOriginal;
                  setRepaymentForm({
                    ...repaymentForm,
                    currency: nextCurr,
                    amountOriginal: nextAmt,
                  });
                }}
                className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              >
                <option value="USD">USD ($)</option>
                <option value="SLSH">SLSH</option>
              </select>
            </div>
            <NumericInput
              step="0.01"
              required
              value={repaymentForm.amountOriginal}
              onChange={(val) =>
                setRepaymentForm({ ...repaymentForm, amountOriginal: val })
              }
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl font-bold bg-slate-50 dark:bg-slate-900"
            />
            <input
              placeholder={t('pos.reference_phone')}
              value={repaymentForm.referencePhone}
              onChange={(e) =>
                setRepaymentForm({ ...repaymentForm, referencePhone: e.target.value })
              }
              className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedForPayment(null)}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-5 py-2 text-xs sm:text-sm bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Confirm Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable PDF Customer Statement Modal */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white text-black p-5 sm:p-6 rounded-2xl max-w-2xl w-full space-y-4">
            <div className="flex justify-between items-start border-b pb-3 gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/baxnaano-logo.jpg"
                  alt="Baxnaano Logo"
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover shrink-0"
                />
                <div>
                  <h2 className="text-sm sm:text-lg font-bold">BAXNAANO CUSTOMER CREDIT STATEMENT</h2>
                  <p className="text-xs sm:text-sm">
                    {String(statementCustomer.name)} | {String(statementCustomer.phone)}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px]">Balance Due</div>
                <div className="text-lg sm:text-2xl font-bold text-red-600">
                  ${statementCustomer.currentBalanceUsd.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b bg-slate-100">
                    <th className="p-2">Date</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Notes</th>
                    <th className="p-2 text-right">Delta (USD)</th>
                    <th className="p-2 text-right">Balance (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {statementCustomer.entries.map((entry) => (
                    <tr key={entry.id} className="border-b">
                      <td className="p-2">{String(entry.createdAt).slice(0, 10)}</td>
                      <td className="p-2 font-semibold">{String(entry.type)}</td>
                      <td className="p-2">{String(entry.notes || '')}</td>
                      <td className="p-2 text-right font-mono">
                        {Number(entry.amountDeltaUsd) > 0
                          ? `+$${Number(entry.amountDeltaUsd).toFixed(2)}`
                          : `-$${Math.abs(Number(entry.amountDeltaUsd)).toFixed(2)}`}
                      </td>
                      <td className="p-2 text-right font-bold">
                        ${Number(entry.balanceAfterUsd || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="print:hidden flex justify-end gap-2 pt-3">
              <button
                onClick={() =>
                  printStatementPdf(statementCustomer as any, activeBranchId)
                }
                className="min-h-[40px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl flex items-center gap-1.5 font-semibold text-xs"
              >
                <Printer className="w-4 h-4" />
                Print Official Statement (PDF)
              </button>
              <button
                onClick={() => setStatementCustomer(null)}
                className="min-h-[40px] px-4 py-2 border rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

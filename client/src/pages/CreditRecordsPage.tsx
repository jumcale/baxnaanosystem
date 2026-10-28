import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CreditCard,
  UserPlus,
  DollarSign,
  Printer,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { mutateOfflineFirst } from '../db/dexie';
import {
  getOfflineCustomersWithAging,
  recordOfflineCreditRepayment,
} from '../services/finance.offline';
import {
  getSavedBranchSettingsSync,
  loadBranchSettings,
} from '../services/settings.offline';
import { NumericInput } from '../components/NumericInput';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';

export const CreditRecordsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, canPerform } = useAuth();

  const [customers, setCustomers] = useState<
    Awaited<ReturnType<typeof getOfflineCustomersWithAging>>
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [selectedForPayment, setSelectedForPayment] = useState<
    (typeof customers)[number] | null
  >(null);
  const [statementCustomer, setStatementCustomer] = useState<
    (typeof customers)[number] | null
  >(null);

  const [newCustomer, setNewCustomer] = useState({
    branchId: activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId,
    name: '',
    phone: '',
    villageOrFarm: '',
    creditLimitUsd: 100,
  });

  const [repaymentForm, setRepaymentForm] = useState(() => {
    const saved = getSavedBranchSettingsSync(activeBranchId);
    return {
      method: 'CASH' as 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB',
      currency: 'USD' as 'USD' | 'SLSH',
      amountOriginal: 0,
      exchangeRateUsed: saved.exchangeRate,
      referencePhone: '',
      notes: '',
    };
  });

  const loadCreditData = async () => {
    const list = await getOfflineCustomersWithAging(activeBranchId);
    setCustomers(list);
  };

  useEffect(() => {
    const refresh = () => {
      loadCreditData();
      loadBranchSettings(activeBranchId).then((s) => {
        setRepaymentForm((prev) => ({ ...prev, exchangeRateUsed: s.exchangeRate }));
      });
    };
    refresh();
    if (activeBranchId !== 'ALL') {
      setNewCustomer((prev) => ({ ...prev, branchId: activeBranchId }));
    }
    window.addEventListener('baxnaano:data-synced', refresh);
    return () => window.removeEventListener('baxnaano:data-synced', refresh);
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

  // Aggregate Aging Totals across displayed customers
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
      activeBranchId === 'ALL'
        ? newCustomer.branchId || BAXNAANO_BRANCHES.B1.id
        : activeBranchId;

    await mutateOfflineFirst('customers', 'Customer', 'CREATE', {
      branchId: targetBranch,
      name: newCustomer.name,
      phone: newCustomer.phone,
      villageOrFarm: newCustomer.villageOrFarm,
      creditLimitUsd: Number(newCustomer.creditLimitUsd),
      currentBalanceUsd: 0,
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
  };

  const handleRecordRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForPayment || !user) return;
    const targetBranch =
      activeBranchId === 'ALL'
        ? String(selectedForPayment.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId;

    await recordOfflineCreditRepayment({
      branchId: targetBranch,
      customerId: selectedForPayment.id,
      method: repaymentForm.method,
      currency: repaymentForm.currency,
      amountOriginal: Number(repaymentForm.amountOriginal),
      exchangeRateUsed: Number(repaymentForm.exchangeRateUsed),
      referencePhone: repaymentForm.referencePhone,
      notes: repaymentForm.notes,
      userId: user.id,
    });

    setSelectedForPayment(null);
    await loadCreditData();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="w-7 h-7 text-emerald-600" />
          {t('credit.title')}
        </h1>
        <button
          onClick={() => setShowAddCustomer(true)}
          className="min-h-[48px] px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl flex items-center gap-2"
        >
          <UserPlus className="w-5 h-5" />
          {t('credit.add_customer')}
        </button>
      </div>

      {/* Aging Summary Cards (0-30, 31-60, 60+ Days) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
          <div className="text-xs text-slate-500">{t('credit.fields.current_balance')}</div>
          <div className="text-2xl font-extrabold mt-1">${totals.totalDue.toFixed(2)}</div>
        </div>
        <div className="bg-emerald-50/70 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800">
          <div className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
            {t('credit.fields.bucket_0_30')}
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-1">
            ${totals.b0_30.toFixed(2)}
          </div>
        </div>
        <div className="bg-amber-50/70 dark:bg-amber-950/20 p-4 rounded-2xl border border-amber-200 dark:border-amber-800">
          <div className="text-xs text-amber-700 dark:text-amber-300 font-semibold">
            {t('credit.fields.bucket_31_60')}
          </div>
          <div className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 mt-1">
            ${totals.b31_60.toFixed(2)}
          </div>
        </div>
        <div className="bg-red-50/70 dark:bg-red-950/20 p-4 rounded-2xl border border-red-200 dark:border-red-800">
          <div className="text-xs text-red-700 dark:text-red-300 font-semibold">
            {t('credit.fields.bucket_60_plus')}
          </div>
          <div className="text-2xl font-extrabold text-red-600 mt-1">
            ${totals.b60_plus.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`${t('credit.fields.name')}, ${t('credit.fields.phone')}, ${t(
            'credit.fields.village_or_farm'
          )}...`}
          className="w-full min-h-[48px] pl-12 pr-4 py-2.5 rounded-xl border bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700"
        />
      </div>

      {/* Customer Ledger Cards */}
      <div className="space-y-3">
        {filteredCustomers.map((c) => (
          <div
            key={c.id}
            className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-lg">{String(c.name)}</h3>
                <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded">
                  {String(c.phone)}
                </span>
                {c.villageOrFarm && (
                  <span className="text-xs text-slate-500">({String(c.villageOrFarm)})</span>
                )}
                {c.aging.isOverdue && (
                  <span className="text-xs bg-red-100 text-red-800 px-2.5 py-1 rounded-full font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t('credit.overdue_alert')}
                  </span>
                )}
                {c.isOverLimit && (
                  <span className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-bold">
                    {t('credit.over_limit')}
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-4">
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

            <div className="flex items-center gap-3">
              <div className="text-right mr-2">
                <div className="text-xs text-slate-400">{t('credit.fields.current_balance')}</div>
                <div className="text-xl font-extrabold text-red-600">
                  ${c.currentBalanceUsd.toFixed(2)}
                </div>
              </div>

              {canPerform('credit:payment') && c.currentBalanceUsd > 0 && (
                <button
                  onClick={() => {
                    setSelectedForPayment(c);
                    setRepaymentForm((prev) => ({
                      ...prev,
                      amountOriginal: c.currentBalanceUsd,
                    }));
                  }}
                  className="min-h-[44px] px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <DollarSign className="w-4 h-4" />
                  {t('credit.record_repayment')}
                </button>
              )}

              <button
                onClick={() => setStatementCustomer(c)}
                className="min-h-[44px] px-3 py-2 border rounded-xl text-sm font-medium flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {t('credit.print_statement')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCustomer}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-md w-full space-y-4"
          >
            <h2 className="text-lg font-bold">{t('credit.add_customer')}</h2>
            <input
              required
              placeholder={t('credit.fields.name')}
              value={newCustomer.name}
              onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />
            <input
              required
              placeholder={t('credit.fields.phone')}
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />
            <input
              placeholder={t('credit.fields.village_or_farm')}
              value={newCustomer.villageOrFarm}
              onChange={(e) => setNewCustomer({ ...newCustomer, villageOrFarm: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
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
                className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Repayment Modal */}
      {selectedForPayment && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordRepayment}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-md w-full space-y-4"
          >
            <h2 className="text-lg font-bold">
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
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
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
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
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
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl font-bold dark:bg-slate-900"
            />
            <input
              placeholder={t('pos.reference_phone')}
              value={repaymentForm.referencePhone}
              onChange={(e) =>
                setRepaymentForm({ ...repaymentForm, referencePhone: e.target.value })
              }
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedForPayment(null)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-emerald-600 text-white font-semibold rounded-xl"
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
          <div className="bg-white text-black p-6 rounded-2xl max-w-2xl w-full space-y-4">
            <div className="flex justify-between items-start border-b pb-3">
              <div className="flex items-center gap-3">
                <img
                  src="/baxnaano-logo.jpg"
                  alt="Baxnaano Logo"
                  className="w-12 h-12 rounded-full object-cover"
                />
                <div>
                  <h2 className="text-xl font-bold">BAXNAANO CUSTOMER CREDIT STATEMENT</h2>
                  <p className="text-sm">
                    {String(statementCustomer.name)} | {String(statementCustomer.phone)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs">Balance Due</div>
                <div className="text-2xl font-extrabold text-red-600">
                  ${statementCustomer.currentBalanceUsd.toFixed(2)}
                </div>
              </div>
            </div>

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

            <div className="print:hidden flex justify-end gap-2 pt-3">
              <button
                onClick={() => window.print()}
                className="min-h-[44px] px-4 py-2 bg-slate-900 text-white rounded-xl flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                Print / Save PDF
              </button>
              <button
                onClick={() => setStatementCustomer(null)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
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

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  Plus,
  Camera,
  CheckCircle,
  XCircle,
  Repeat,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { db, isRecordVisibleToCurrentUser } from '../db/dexie';
import {
  createOfflineExpense,
  approveOfflineExpense,
} from '../services/finance.offline';
import {
  getSavedBranchSettingsSync,
  loadBranchSettings,
} from '../services/settings.offline';
import { NumericInput } from '../components/NumericInput';

export const ExpensesPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, canPerform } = useAuth();

  const [expenses, setExpenses] = useState<Array<Record<string, unknown>>>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const [form, setForm] = useState(() => {
    const saved = getSavedBranchSettingsSync(activeBranchId);
    return {
      branchId: activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId,
      category: 'UTILITIES',
      payee: '',
      currencyPaid: 'USD' as 'USD' | 'SLSH',
      amountOriginal: 0,
      exchangeRateUsed: saved.exchangeRate,
      paymentMethod: 'CASH',
      description: '',
      receiptPhotoData: null as string | null,
      isRecurring: false,
      recurringFrequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY',
    };
  });

  const loadExpenses = async () => {
    const rawList =
      activeBranchId === 'ALL'
        ? await db.expenses.filter((e) => !e.deletedAt).toArray()
        : await db.expenses
            .where('branchId')
            .equals(activeBranchId)
            .filter((e) => !e.deletedAt)
            .toArray();

    const list = rawList.filter((e) => isRecordVisibleToCurrentUser(e));

    list.sort(
      (a, b) =>
        new Date(String(b.expenseDate)).getTime() -
        new Date(String(a.expenseDate)).getTime()
    );
    setExpenses(list);
  };

  useEffect(() => {
    const refresh = () => {
      loadExpenses();
      loadBranchSettings(activeBranchId).then((s) => {
        setForm((prev) => ({
          ...prev,
          branchId: activeBranchId === 'ALL' ? prev.branchId : activeBranchId,
          exchangeRateUsed: s.exchangeRate,
        }));
      });
    };
    refresh();
    window.addEventListener('baxnaano:data-synced', refresh);
    return () => window.removeEventListener('baxnaano:data-synced', refresh);
  }, [activeBranchId]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => ({ ...prev, receiptPhotoData: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const targetBranch =
      activeBranchId === 'ALL'
        ? form.branchId || BAXNAANO_BRANCHES.B1.id
        : activeBranchId;

    await createOfflineExpense({
      branchId: targetBranch,
      category: form.category,
      currencyPaid: form.currencyPaid,
      amountOriginal: Number(form.amountOriginal),
      exchangeRateUsed: Number(form.exchangeRateUsed),
      paymentMethod: form.paymentMethod,
      payee: form.payee,
      description: form.description,
      receiptPhotoData: form.receiptPhotoData,
      isRecurring: form.isRecurring,
      recurringFrequency: form.isRecurring ? form.recurringFrequency : null,
      userId: user.id,
      userRole: user.role,
    });

    setShowAddModal(false);
    setForm((prev) => ({
      ...prev,
      payee: '',
      amountOriginal: 0,
      description: '',
      receiptPhotoData: null,
      isRecurring: false,
    }));
    await loadExpenses();
  };

  const handleApproval = async (expenseId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!user) return;
    await approveOfflineExpense(expenseId, status, user.id);
    await loadExpenses();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="w-7 h-7 text-emerald-600" />
          {t('expenses.title')}
        </h1>
        {canPerform('expenses:create') && (
          <button
            onClick={() => setShowAddModal(true)}
            className="min-h-[48px] px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            {t('expenses.add_expense')}
          </button>
        )}
      </div>

      {/* Expense Cards */}
      <div className="grid grid-cols-1 gap-3">
        {expenses.map((exp) => {
          const status = String(exp.approvalStatus || 'PENDING');
          return (
            <div
              key={String(exp.id)}
              className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-700">
                    {String(exp.category)}
                  </span>
                  <h3 className="font-bold text-base">{String(exp.payee)}</h3>
                  {Boolean(exp.isRecurring) && (
                    <span className="text-xs bg-sky-100 text-sky-800 px-2.5 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      <Repeat className="w-3 h-3" />
                      {String(exp.recurringFrequency)}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                      status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : status === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {t(`expenses.status_${status}`)}
                  </span>
                </div>
                {Boolean(exp.description) && (
                  <p className="text-xs text-slate-500">{String(exp.description)}</p>
                )}
                <div className="text-[11px] text-slate-400">
                  {new Date(String(exp.expenseDate)).toLocaleString()} | Method:{' '}
                  {String(exp.paymentMethod)}
                </div>
              </div>

              <div className="flex items-center gap-4">
                {Boolean(exp.receiptPhotoData) && (
                  <img
                    src={String(exp.receiptPhotoData)}
                    alt="Receipt"
                    className="w-12 h-12 object-cover rounded-lg border"
                  />
                )}

                <div className="text-right">
                  <div className="text-lg font-extrabold text-slate-900 dark:text-white">
                    ${Number(exp.amountUsd || 0).toFixed(2)}
                  </div>
                  {exp.currencyPaid === 'SLSH' && (
                    <div className="text-xs text-slate-400">
                      ({Number(exp.amountOriginal).toLocaleString()} SLSH)
                    </div>
                  )}
                </div>

                {/* Branch Manager / Admin Approval Actions */}
                {status === 'PENDING' && canPerform('expenses:approve') && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproval(String(exp.id), 'APPROVED')}
                      className="min-h-[42px] px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1"
                    >
                      <CheckCircle className="w-4 h-4" />
                      {t('expenses.approve')}
                    </button>
                    <button
                      onClick={() => handleApproval(String(exp.id), 'REJECTED')}
                      className="min-h-[42px] px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-xl flex items-center gap-1"
                    >
                      <XCircle className="w-4 h-4" />
                      {t('expenses.reject')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-md w-full space-y-4"
          >
            <h2 className="text-lg font-bold">{t('expenses.add_expense')}</h2>

            <div>
              <label className="block text-xs font-semibold mb-1">{t('expenses.category')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <input
              required
              placeholder={t('expenses.payee')}
              value={form.payee}
              onChange={(e) => setForm({ ...form, payee: e.target.value })}
              className="w-full min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={form.currencyPaid}
                onChange={(e) =>
                  setForm({ ...form, currencyPaid: e.target.value as 'USD' | 'SLSH' })
                }
                className="min-h-[46px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              >
                <option value="USD">USD ($)</option>
                <option value="SLSH">SLSH</option>
              </select>
              <NumericInput
                step="0.01"
                required
                placeholder={t('expenses.amount')}
                value={form.amountOriginal}
                onChange={(val) => setForm({ ...form, amountOriginal: val })}
                className="min-h-[46px] px-3 py-2 border rounded-xl font-bold dark:bg-slate-900"
              />
            </div>

            {/* Offline Receipt Photo Capture */}
            <label className="flex items-center justify-center gap-2 min-h-[46px] border-2 border-dashed rounded-xl cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">
              <Camera className="w-5 h-5 text-emerald-600" />
              {t('expenses.receipt_photo')}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </label>

            {/* Recurring Expense Toggle */}
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
                className="w-5 h-5"
              />
              {t('expenses.recurring')}
            </label>

            {form.isRecurring && (
              <select
                value={form.recurringFrequency}
                onChange={(e) =>
                  setForm({
                    ...form,
                    recurringFrequency: e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY',
                  })
                }
                className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
              >
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
              </select>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-emerald-600 text-white font-semibold rounded-xl"
              >
                Save Expense
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

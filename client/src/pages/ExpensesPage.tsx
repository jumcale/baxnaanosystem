import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  Plus,
  Camera,
  CheckCircle,
  XCircle,
  Repeat,
  FileText,
  Trash2,
  FileBarChart,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { useAuth } from '../context/AuthContext';
import { expensesApi, settingsApi } from '../api';
import { NumericInput } from '../components/NumericInput';

export const ExpensesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, activeBranchId, canPerform, canViewModule } = useAuth();

  const [expenses, setExpenses] = useState<Array<any>>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [form, setForm] = useState({
    branchId: activeBranchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : activeBranchId,
    category: 'UTILITIES',
    payee: '',
    currencyPaid: 'USD' as 'USD' | 'SLSH',
    amountOriginal: 0,
    exchangeRateUsed: 10000,
    paymentMethod: 'CASH',
    description: '',
    receiptPhotoData: null as string | null,
    isRecurring: false,
    recurringFrequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY',
  });

  const loadExpenses = async () => {
    try {
      const list = await expensesApi.getExpenses({
        branchId: activeBranchId,
      });
      setExpenses(list);
    } catch (err) {
      console.error('Failed to load expenses:', err);
    }
  };

  useEffect(() => {
    loadExpenses();
    settingsApi.getBranches().then((branches) => {
      const b = branches.find((item) => item.id === activeBranchId || item.code === activeBranchId);
      if (b?.exchangeRate) {
        setForm((prev) => ({
          ...prev,
          branchId: activeBranchId === 'ALL' ? prev.branchId : activeBranchId,
          exchangeRateUsed: b.exchangeRate,
        }));
      }
    });

    const onFocus = () => loadExpenses();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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
      user.branchId ||
      (activeBranchId === 'ALL'
        ? form.branchId || BAXNAANO_BRANCHES.B1.id
        : activeBranchId);

    try {
      await expensesApi.createExpense({
        branchId: targetBranch,
        category: form.category,
        currencyPaid: form.currencyPaid,
        amountOriginal: Number(form.amountOriginal),
        exchangeRateUsed: Number(form.exchangeRateUsed),
        paymentMethod: form.paymentMethod,
        payee: form.payee.trim(),
        description: form.description.trim() || undefined,
        receiptPhotoData: form.receiptPhotoData,
        isRecurring: form.isRecurring,
        recurringFrequency: form.isRecurring ? form.recurringFrequency : undefined,
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
    } catch (err: any) {
      alert(err?.message || 'Failed to record expense on server.');
    }
  };

  const handleApproval = async (expenseId: string, status: 'APPROVED' | 'REJECTED') => {
    if (!user) return;
    try {
      await expensesApi.approveExpense(expenseId, status);
      await loadExpenses();
    } catch (err: any) {
      alert(err?.message || 'Approval failed.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || user?.role !== 'ADMIN') return;
    setIsDeleting(true);
    try {
      await expensesApi.deleteExpense(String(deleteTarget.id));
      setDeleteTarget(null);
      await loadExpenses();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete expense.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2 min-w-0">
          <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 shrink-0" />
          <span className="truncate">{t('expenses.title')}</span>
        </h1>
        <div className="flex items-center gap-2 shrink-0">
          {canViewModule('REPORTS') && (
            <button
              type="button"
              onClick={() => navigate('/reports?type=EXPENSE&tab=TRANSACTIONS')}
              className="min-h-[40px] px-3 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition"
            >
              <FileBarChart className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Financial Report</span>
            </button>
          )}
          {canPerform('expenses:create') && (
            <button
              onClick={() => setShowAddModal(true)}
              className="min-h-[40px] px-3.5 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 shadow-sm shrink-0 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{t('expenses.add_expense')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Expense Cards */}
      <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
        {expenses.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-xs sm:text-sm text-slate-400">
            No expenses recorded yet for this branch scope.
          </div>
        ) : (
          expenses.map((exp) => {
            const status = String(exp.approvalStatus || 'PENDING');
            return (
              <div
                key={String(exp.id)}
                className="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-700/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {String(exp.category)}
                    </span>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                      {String(exp.payee)}
                    </h3>
                    {Boolean(exp.isRecurring) && (
                      <span className="text-[11px] bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Repeat className="w-3 h-3" />
                        {String(exp.recurringFrequency)}
                      </span>
                    )}
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        status === 'APPROVED'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                          : status === 'REJECTED'
                          ? 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300'
                          : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {t(`expenses.status_${status}`)}
                    </span>
                  </div>
                  {Boolean(exp.description) && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-1.5 pt-0.5">
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>{String(exp.description)}</span>
                    </p>
                  )}
                  <div className="text-[11px] text-slate-400">
                    {new Date(String(exp.expenseDate)).toLocaleString()} • {String(exp.paymentMethod)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 sm:gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/60">
                  {Boolean(exp.receiptPhotoData) && (
                    <img
                      src={String(exp.receiptPhotoData)}
                      alt="Receipt"
                      className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                    />
                  )}

                  <div className="text-left sm:text-right">
                    <div className="text-base sm:text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                      ${Number(exp.amountUsd || 0).toFixed(2)}
                    </div>
                    {exp.currencyPaid === 'SLSH' && (
                      <div className="text-[11px] text-slate-400 tabular-nums">
                        ({Number(exp.amountOriginal).toLocaleString()} SLSH)
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Branch Manager / Admin Approval Actions */}
                    {status === 'PENDING' && canPerform('expenses:approve') && (
                      <>
                        <button
                          onClick={() => handleApproval(String(exp.id), 'APPROVED')}
                          className="min-h-[36px] px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{t('expenses.approve')}</span>
                        </button>
                        <button
                          onClick={() => handleApproval(String(exp.id), 'REJECTED')}
                          className="min-h-[36px] px-2.5 sm:px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{t('expenses.reject')}</span>
                        </button>
                      </>
                    )}

                    {/* Admin-Only Delete Expense Button */}
                    {user?.role === 'ADMIN' && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(exp)}
                        title="Delete / Remove Incorrect Expense (Admin Only)"
                        className="min-h-[36px] px-2.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/70 text-xs font-semibold rounded-lg flex items-center gap-1 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{t('expenses.delete', 'Delete')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Admin Delete Confirmation Modal */}
      {deleteTarget && user?.role === 'ADMIN' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
              <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold">
                Delete Expense / Tirtir Kharashka
              </h2>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently remove this expense record?
            </p>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Payee / Category:</span>
                <strong className="text-slate-900 dark:text-white">
                  {String(deleteTarget.payee)} ({String(deleteTarget.category)})
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <strong className="text-red-600 tabular-nums">
                  ${Number(deleteTarget.amountUsd || 0).toFixed(2)}
                </strong>
              </div>
              {Boolean(deleteTarget.description) && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 shrink-0">Description:</span>
                  <span className="text-slate-700 dark:text-slate-300 truncate">
                    {String(deleteTarget.description)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold rounded-xl shadow-sm flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>{isDeleting ? 'Deleting...' : 'Confirm Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-t-2xl sm:rounded-2xl max-w-md w-full space-y-3.5 shadow-2xl"
          >
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              {t('expenses.add_expense')}
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t('expenses.category')}
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t('expenses.payee')}
              </label>
              <input
                required
                placeholder={t('expenses.payee')}
                value={form.payee}
                onChange={(e) => setForm({ ...form, payee: e.target.value })}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              />
            </div>

            {/* Expense Description Field with Placeholder */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                {t('expenses.description', 'Description / Faahfaahinta Kharashka')}
              </label>
              <textarea
                rows={2}
                placeholder={t(
                  'expenses.description_placeholder',
                  'Write description of the expense (e.g., Monthly electricity bill, transport, office supplies...)'
                )}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Currency
                </label>
                <select
                  value={form.currencyPaid}
                  onChange={(e) =>
                    setForm({ ...form, currencyPaid: e.target.value as 'USD' | 'SLSH' })
                  }
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
                >
                  <option value="USD">USD ($)</option>
                  <option value="SLSH">SLSH</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t('expenses.amount')}
                </label>
                <NumericInput
                  step="0.01"
                  required
                  placeholder={t('expenses.amount')}
                  value={form.amountOriginal}
                  onChange={(val) => setForm({ ...form, amountOriginal: val })}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl font-bold bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>

            {/* Receipt Photo Capture */}
            <label className="flex items-center justify-center gap-2 min-h-[44px] border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-emerald-500 transition">
              <Camera className="w-4 h-4 text-emerald-600" />
              <span>{t('expenses.receipt_photo')}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </label>

            {/* Recurring Expense Toggle */}
            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
                className="w-4 h-4 rounded accent-emerald-600"
              />
              <span>{t('expenses.recurring')}</span>
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
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
              >
                <option value="DAILY">DAILY</option>
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
              </select>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[42px] px-4 py-2 text-xs sm:text-sm font-semibold border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-5 py-2 text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-sm"
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

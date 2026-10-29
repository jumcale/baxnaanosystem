import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  Printer,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { salesApi, ReceiptData } from '../api';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';

export const SalesHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, canPerform } = useAuth();

  const [sales, setSales] = useState<Array<any>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [voidTargetSale, setVoidTargetSale] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [reprintReceipt, setReprintReceipt] = useState<ReceiptData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const loadSalesHistory = async () => {
    setIsLoading(true);
    try {
      const data = await salesApi.getSales({
        branchId: activeBranchId,
        date: dateFilter || undefined,
      });
      setSales(data.sales || []);
      setErrorBanner(null);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to load sales history from central server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSalesHistory();
    const onFocus = () => loadSalesHistory();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeBranchId, dateFilter]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (dateFilter && !String(s.soldAt).startsWith(dateFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          String(s.receiptNumber).toLowerCase().includes(q) ||
          String(s.customerName || '').toLowerCase().includes(q) ||
          String(s.cashierName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sales, searchQuery, dateFilter]);

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTargetSale || !user || !voidReason.trim()) return;

    try {
      await salesApi.voidSale(String(voidTargetSale.id), voidReason.trim());
      setVoidTargetSale(null);
      setVoidReason('');
      await loadSalesHistory();
    } catch (err: any) {
      alert(err?.message || 'Failed to void sale on central server.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="w-7 h-7 text-emerald-600" />
          {t('sales_history.title')}
        </h1>

        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Receipt #, Customer, Cashier..."
              className="min-h-[44px] pl-9 pr-3 py-2 border rounded-xl bg-white dark:bg-slate-800 text-sm"
            />
          </div>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="min-h-[44px] px-3 py-2 border rounded-xl bg-white dark:bg-slate-800 text-sm"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filteredSales.map((s) => {
          const status = String(s.status || 'COMPLETED');
          return (
            <div
              key={String(s.id)}
              className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded">
                    #{String(s.receiptNumber)}
                  </span>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                      status === 'VOIDED'
                        ? 'bg-red-100 text-red-800 line-through'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {t(`sales_history.status_${status}`)}
                  </span>
                  {Boolean(s.customerName) && (
                    <span className="text-sm font-semibold">{String(s.customerName)}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(String(s.soldAt)).toLocaleString()} | Cashier:{' '}
                  {String(s.cashierName || '')}
                </div>
                {Boolean(s.voidOrRefundReason) && (
                  <div className="text-xs text-red-600 font-medium mt-1">
                    Audit Reason: {String(s.voidOrRefundReason)}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right mr-2">
                  <div className="text-lg font-extrabold text-emerald-600">
                    ${Number(s.totalUsd || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {Number(s.totalSlsh || 0).toLocaleString()} SLSH
                  </div>
                </div>

                <button
                  onClick={async () => {
                    try {
                      const receipt = await salesApi.getReceipt(String(s.id));
                      setReprintReceipt(receipt);
                    } catch {
                      window.print();
                    }
                  }}
                  className="min-h-[42px] px-3 py-2 border rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  {t('sales_history.reprint_receipt')}
                </button>

                {status === 'COMPLETED' && canPerform('sales:approve_void_refund') && (
                  <button
                    onClick={() => setVoidTargetSale(s)}
                    className="min-h-[42px] px-3 py-2 bg-red-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t('sales_history.void_sale')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Void Approval & Audit Reason Modal */}
      {voidTargetSale && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmVoid}
            className="bg-white dark:bg-slate-800 p-6 rounded-2xl max-w-md w-full space-y-4"
          >
            <h2 className="text-lg font-bold text-red-600">
              {t('sales_history.void_sale')} #{String(voidTargetSale.receiptNumber)}
            </h2>
            <p className="text-xs text-slate-500">
              {t('sales_history.void_reason_prompt')}
            </p>
            <textarea
              required
              minLength={4}
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g., Wrong medicine strength dispensed; returned unopened"
              className="w-full p-3 border rounded-xl dark:bg-slate-900 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTargetSale(null)}
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 bg-red-600 text-white font-semibold rounded-xl"
              >
                Confirm Void & Reverse Stock
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Thermal Receipt Reprint Modal */}
      {reprintReceipt && (
        <ReceiptPreviewModal
          receipt={reprintReceipt}
          onCloseAndNewSale={() => setReprintReceipt(null)}
        />
      )}
    </div>
  );
};

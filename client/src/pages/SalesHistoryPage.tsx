import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  Printer,
  RotateCcw,
  Search,
  FileText,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { salesApi, ReceiptData } from '../api';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import { printInvoicePdf } from '../services/receiptPdf';

export const SalesHistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId, canPerform } = useAuth();

  const [sales, setSales] = useState<Array<any>>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [voidTargetSale, setVoidTargetSale] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [reprintReceipt, setReprintReceipt] = useState<ReceiptData | null>(null);

  const loadSalesHistory = async () => {
    try {
      const data = await salesApi.getSales({
        branchId: activeBranchId,
        date: dateFilter || undefined,
      });
      setSales(data.sales || []);
    } catch (err: any) {
      console.error('Failed to load sales history:', err);
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
          <History className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 shrink-0" />
          <span>{t('sales_history.title')}</span>
        </h1>

        <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Receipt #, Customer, Cashier..."
              className="w-full sm:w-60 min-h-[40px] pl-9 pr-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-xs sm:text-sm"
            />
          </div>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="min-h-[40px] px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-xs sm:text-sm"
          />
        </div>
      </div>

      <div className="space-y-2.5 sm:space-y-3">
        {filteredSales.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-xs sm:text-sm text-slate-400">
            No sales records match your search criteria.
          </div>
        ) : (
          filteredSales.map((s) => {
            const status = String(s.status || 'COMPLETED');
            return (
              <div
                key={String(s.id)}
                className="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-700/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-bold text-xs bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                      #{String(s.receiptNumber)}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                        status === 'VOIDED'
                          ? 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 line-through'
                          : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {t(`sales_history.status_${status}`)}
                    </span>
                    {Boolean(s.customerName) && (
                      <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                        {String(s.customerName)}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {new Date(String(s.soldAt)).toLocaleString()} • Cashier:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {String(s.cashierName || '')}
                    </span>
                  </div>
                  {Boolean(s.voidOrRefundReason) && (
                    <div className="text-xs text-red-600 font-medium">
                      Audit Reason: {String(s.voidOrRefundReason)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-700/60">
                  <div className="text-left md:text-right mr-1 tabular-nums">
                    <div className="text-base sm:text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      ${Number(s.totalUsd || 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {Number(s.totalSlsh || 0).toLocaleString()} SLSH
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={async () => {
                        try {
                          const receipt = await salesApi.getReceipt(String(s.id));
                          printInvoicePdf(receipt);
                        } catch (err) {
                          console.error('Failed to load invoice for printing:', err);
                        }
                      }}
                      className="min-h-[36px] px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-blue-100"
                      title="Print or Save A4 Tax Invoice PDF with Company Logo"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>A4 Invoice</span>
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          const receipt = await salesApi.getReceipt(String(s.id));
                          setReprintReceipt(receipt);
                        } catch (err) {
                          console.error('Failed to load receipt:', err);
                        }
                      }}
                      className="min-h-[36px] px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{t('sales_history.reprint_receipt')}</span>
                    </button>

                    {status === 'COMPLETED' && canPerform('sales:approve_void_refund') && (
                      <button
                        onClick={() => setVoidTargetSale(s)}
                        className="min-h-[36px] px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Void</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Void Approval & Audit Reason Modal */}
      {voidTargetSale && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmVoid}
            className="bg-white dark:bg-slate-800 p-5 sm:p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl"
          >
            <h2 className="text-base sm:text-lg font-bold text-red-600">
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
              className="w-full p-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTargetSale(null)}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] px-5 py-2 text-xs sm:text-sm bg-red-600 text-white font-semibold rounded-xl"
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

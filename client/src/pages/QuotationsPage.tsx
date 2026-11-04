import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileSpreadsheet,
  Plus,
  Share2,
  Printer,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  quotationsApi,
  inventoryApi,
  settingsApi,
  ReceiptData,
  ServerProductWithFEFO,
} from '../api';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import { NumericInput } from '../components/NumericInput';
import { printQuotationPdf, shareQuotationPdfWhatsApp } from '../services/quotationPdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';

export const QuotationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const [quotations, setQuotations] = useState<Array<any>>([]);
  const [products, setProducts] = useState<ServerProductWithFEFO[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [convertedReceipt, setConvertedReceipt] = useState<ReceiptData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    exchangeRateUsed: 10000,
    discountUsd: 0,
    selectedProductId: '',
    selectedQty: 1,
    items: [] as Array<{
      productId: string;
      productName: string;
      sku: string;
      quantity: number;
      unitPriceUsd: number;
    }>,
  });

  const loadQuotations = async () => {
    try {
      const [qList, pList] = await Promise.all([
        quotationsApi.getQuotations(activeBranchId),
        inventoryApi.getProducts(activeBranchId),
      ]);
      setQuotations(qList);
      setProducts(pList);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load quotations from server.');
    }
  };

  useEffect(() => {
    loadQuotations();
    settingsApi.getBranches().then((branches) => {
      const b = branches.find((item) => item.id === activeBranchId || item.code === activeBranchId);
      if (b?.exchangeRate) {
        setForm((prev) => ({ ...prev, exchangeRateUsed: b.exchangeRate }));
      }
    });

    const onFocus = () => loadQuotations();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [activeBranchId]);

  const buildLineItemFromSelection = () => {
    const prod = products.find((p) => p.id === form.selectedProductId);
    if (!prod) return null;
    return {
      productId: prod.id,
      productName: String(prod.name),
      sku: String(prod.sku),
      quantity: Math.max(1, Number(form.selectedQty) || 1),
      unitPriceUsd: Number(prod.sellPriceUsd),
    };
  };

  const handleAddLineItem = () => {
    const line = buildLineItemFromSelection();
    if (!line) {
      setFormError('Please select a product first.');
      return;
    }
    setFormError(null);
    setForm((prev) => {
      const existingIdx = prev.items.findIndex((i) => i.productId === line.productId);
      const nextItems =
        existingIdx >= 0
          ? prev.items.map((i, idx) =>
              idx === existingIdx ? { ...i, quantity: i.quantity + line.quantity } : i
            )
          : [...prev.items, line];
      return { ...prev, items: nextItems, selectedProductId: '', selectedQty: 1 };
    });
  };

  const handleRemoveLineItem = (idx: number) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!user) {
      setFormError('You must be signed in to save a quotation.');
      return;
    }

    let items = form.items;
    const pendingLine = buildLineItemFromSelection();
    if (pendingLine && !items.some((i) => i.productId === pendingLine.productId)) {
      items = [...items, pendingLine];
    }

    if (items.length === 0) {
      setFormError('Add at least one product to the quotation.');
      return;
    }

    const firstProd = products.find((p) => p.id === items[0].productId);
    const targetBranch =
      user.branchId ||
      (activeBranchId === 'ALL'
        ? String(firstProd?.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId);

    setIsSaving(true);
    try {
      await quotationsApi.createQuotation({
        branchId: targetBranch,
        customerName: form.customerName.trim() || 'Walk-in',
        customerPhone: form.customerPhone.trim() || undefined,
        currency: 'USD',
        exchangeRateUsed: form.exchangeRateUsed,
        discountUsd: form.discountUsd,
        validUntil: form.validUntil
          ? new Date(form.validUntil).toISOString()
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceUsd: i.unitPriceUsd,
        })),
      });

      setShowCreateModal(false);
      setForm((prev) => ({
        ...prev,
        customerName: '',
        customerPhone: '',
        discountUsd: 0,
        selectedProductId: '',
        selectedQty: 1,
        items: [],
      }));
      await loadQuotations();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save quotation on server.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleShareWhatsApp = async (q: any) => {
    try {
      await shareQuotationPdfWhatsApp(q);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not share PDF');
    }
  };

  const handleConvert = async (target: any) => {
    if (!user) return;
    setErrorMsg(null);
    const quotation =
      typeof target === 'string' ? quotations.find((q) => q.id === target) : target;
    if (!quotation) return;
    try {
      const receipt = await quotationsApi.convertToSale(quotation, 'CASH');
      setConvertedReceipt(receipt);
      await loadQuotations();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Conversion failed on server.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2 min-w-0">
          <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 shrink-0" />
          <span className="truncate">{t('quotations.title')}</span>
        </h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="min-h-[40px] px-3.5 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 shadow-sm shrink-0 transition"
        >
          <Plus className="w-4 h-4" />
          <span>{t('quotations.create_quote')}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl text-xs sm:text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="space-y-2.5 sm:space-y-3">
        {quotations.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-xs sm:text-sm text-slate-400">
            No price quotations created yet.
          </div>
        ) : (
          quotations.map((q) => {
            const isExpired =
              q.status !== 'CONVERTED' && new Date(String(q.validUntil)) < new Date();
            const status = isExpired ? 'EXPIRED' : String(q.status || 'SENT');

            return (
              <div
                key={String(q.id)}
                className="bg-white dark:bg-slate-800 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200/90 dark:border-slate-700/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                      {String(q.quotationNumber)}
                    </span>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                      {String(q.customerName || 'Walk-in')}
                    </h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                      {t(`quotations.status_${status}`)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {t('quotations.valid_until')}: {String(q.validUntil).slice(0, 10)} •{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      ${Number(q.totalUsd).toFixed(2)}
                    </strong>{' '}
                    ({Number(q.totalSlsh).toLocaleString()} SLSH)
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/60">
                  <button
                    onClick={() => handleShareWhatsApp(q)}
                    className="min-h-[38px] px-2.5 sm:px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{t('quotations.share_whatsapp')}</span>
                  </button>
                  <button
                    onClick={() => printQuotationPdf(q)}
                    className="min-h-[38px] px-2.5 sm:px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{t('quotations.print_pdf')}</span>
                  </button>
                  {status === 'SENT' && (
                    <button
                      onClick={() => handleConvert(String(q.id))}
                      className="min-h-[38px] px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{t('quotations.convert_to_sale')}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create Quotation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
          <form
            onSubmit={handleSaveQuotation}
            className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h2 className="text-base sm:text-lg font-bold">{t('quotations.create_quote')}</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3.5">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-300 text-red-700 rounded-xl text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  placeholder="Customer Name"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="w-full min-w-0 min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
                />
                <input
                  type="tel"
                  placeholder="WhatsApp Phone (+252...)"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                  className="w-full min-w-0 min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">
                  {t('quotations.valid_until')}
                </label>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold">Add Product</label>
                <select
                  value={form.selectedProductId}
                  onChange={(e) => setForm({ ...form, selectedProductId: e.target.value })}
                  className="w-full min-w-0 min-h-[42px] px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-sm"
                >
                  <option value="">-- Select Product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {String(p.name)} (${Number(p.sellPriceUsd).toFixed(2)})
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 shrink-0">Qty</span>
                  <NumericInput
                    min={1}
                    value={form.selectedQty}
                    onChange={(val) => setForm({ ...form, selectedQty: Math.max(1, val) })}
                    className="flex-1 min-w-0 min-h-[42px] px-2 border border-slate-300 dark:border-slate-700 rounded-xl text-center bg-slate-50 dark:bg-slate-900 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="min-h-[42px] px-4 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold shrink-0"
                  >
                    + Add
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                {form.items.length === 0 ? (
                  <div className="text-center py-3 text-slate-400">No products added yet.</div>
                ) : (
                  form.items.map((item, idx) => (
                    <div
                      key={`${item.productId}-${idx}`}
                      className="flex items-center justify-between gap-2 p-2.5 bg-slate-100 dark:bg-slate-900 rounded-lg"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {item.productName} × {item.quantity}
                      </span>
                      <span className="font-bold shrink-0 tabular-nums">
                        ${(item.quantity * item.unitPriceUsd).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(idx)}
                        className="w-7 h-7 shrink-0 rounded-lg text-red-600 hover:bg-red-50 font-bold"
                        aria-label="Remove item"
                      >
                        ✕
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0 bg-white dark:bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setShowCreateModal(false);
                }}
                className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold border border-slate-300 dark:border-slate-700 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[40px] px-5 py-2 text-xs sm:text-sm bg-emerald-600 disabled:bg-slate-400 text-white font-semibold rounded-xl"
              >
                {isSaving ? 'Saving...' : 'Save Quotation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {convertedReceipt && (
        <ReceiptPreviewModal
          receipt={convertedReceipt}
          onCloseAndNewSale={() => setConvertedReceipt(null)}
        />
      )}
    </div>
  );
};

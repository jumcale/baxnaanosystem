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
import { db, isRecordVisibleToCurrentUser } from '../db/dexie';
import { getOfflineProductsWithFEFO } from '../services/inventory.offline';
import {
  createOfflineQuotation,
  convertOfflineQuotationToSale,
} from '../services/finance.offline';
import { OfflineReceiptData } from '../services/sales.offline';
import { ReceiptPreviewModal } from '../components/ReceiptPreviewModal';
import {
  getSavedBranchSettingsSync,
  loadBranchSettings,
} from '../services/settings.offline';
import { NumericInput } from '../components/NumericInput';
import { printQuotationPdf, shareQuotationPdfWhatsApp } from '../services/quotationPdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';

export const QuotationsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user, activeBranchId } = useAuth();

  const [quotations, setQuotations] = useState<Array<Record<string, unknown>>>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof getOfflineProductsWithFEFO>>>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [convertedReceipt, setConvertedReceipt] = useState<OfflineReceiptData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [form, setForm] = useState(() => {
    const saved = getSavedBranchSettingsSync(activeBranchId);
    return {
      customerName: '',
      customerPhone: '',
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      exchangeRateUsed: saved.exchangeRate,
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
    };
  });

  const loadQuotations = async () => {
    const rawQList =
      activeBranchId === 'ALL'
        ? await db.quotations.filter((q) => !q.deletedAt).toArray()
        : await db.quotations
            .where('branchId')
            .equals(activeBranchId)
            .filter((q) => !q.deletedAt)
            .toArray();
    setQuotations(rawQList.filter((q) => isRecordVisibleToCurrentUser(q)));

    const pList = await getOfflineProductsWithFEFO(activeBranchId);
    setProducts(pList);
  };

  useEffect(() => {
    const refresh = () => {
      loadQuotations();
      loadBranchSettings(activeBranchId).then((s) => {
        setForm((prev) => ({ ...prev, exchangeRateUsed: s.exchangeRate }));
      });
    };
    refresh();
    window.addEventListener('baxnaano:data-synced', refresh);
    return () => window.removeEventListener('baxnaano:data-synced', refresh);
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

    // Auto-include a product that was selected but not yet added with "+"
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
      activeBranchId === 'ALL'
        ? String(firstProd?.branchId || BAXNAANO_BRANCHES.B1.id)
        : activeBranchId;

    setIsSaving(true);
    try {
      await createOfflineQuotation({
        branchId: targetBranch,
        customerName: form.customerName.trim() || 'Walk-in',
        customerPhone: form.customerPhone.trim(),
        exchangeRateUsed: form.exchangeRateUsed,
        discountUsd: form.discountUsd,
        validUntil: form.validUntil,
        userId: user.id,
        items,
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
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save quotation.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleShareWhatsApp = async (q: Record<string, unknown>) => {
    try {
      await shareQuotationPdfWhatsApp(q);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not share PDF');
    }
  };

  const handleConvert = async (quotationId: string) => {
    if (!user) return;
    setErrorMsg(null);
    try {
      const receipt = await convertOfflineQuotationToSale(quotationId, 'CASH', {
        id: user.id,
        fullName: user.fullName,
      });
      setConvertedReceipt(receipt);
      await loadQuotations();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Conversion failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="w-7 h-7 text-emerald-600" />
          {t('quotations.title')}
        </h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="min-h-[48px] px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-xl flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          {t('quotations.create_quote')}
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-300 text-red-700 rounded-xl text-sm font-medium">
          {errorMsg}
        </div>
      )}

      <div className="space-y-3">
        {quotations.map((q) => {
          const isExpired =
            q.status !== 'CONVERTED' && new Date(String(q.validUntil)) < new Date();
          const status = isExpired ? 'EXPIRED' : String(q.status || 'SENT');

          return (
            <div
              key={String(q.id)}
              className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded">
                    {String(q.quotationNumber)}
                  </span>
                  <h3 className="font-bold text-base">{String(q.customerName || 'Walk-in')}</h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                    {t(`quotations.status_${status}`)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {t('quotations.valid_until')}: {String(q.validUntil).slice(0, 10)} | Total: $
                  {Number(q.totalUsd).toFixed(2)} ({Number(q.totalSlsh).toLocaleString()} SLSH)
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleShareWhatsApp(q)}
                  className="min-h-[42px] px-3 py-2 bg-green-600 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  {t('quotations.share_whatsapp')}
                </button>
                <button
                  onClick={() => printQuotationPdf(q)}
                  className="min-h-[42px] px-3 py-2 border text-xs font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  {t('quotations.print_pdf')}
                </button>
                {status === 'SENT' && (
                  <button
                    onClick={() => handleConvert(String(q.id))}
                    className="min-h-[42px] px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {t('quotations.convert_to_sale')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Quotation Modal — mobile-friendly, scrollable body with sticky action footer */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
          <form
            onSubmit={handleSaveQuotation}
            className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <h2 className="text-lg font-bold">{t('quotations.create_quote')}</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
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
                  className="w-full min-w-0 min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
                <input
                  type="tel"
                  placeholder="WhatsApp Phone (+252...)"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                  className="w-full min-w-0 min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
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
                  className="w-full min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900"
                />
              </div>

              {/* Product picker: select on its own row, qty + add on the next row (no overflow on phones) */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold">Add Product</label>
                <select
                  value={form.selectedProductId}
                  onChange={(e) => setForm({ ...form, selectedProductId: e.target.value })}
                  className="w-full min-w-0 min-h-[44px] px-3 py-2 border rounded-xl dark:bg-slate-900 text-sm"
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
                    className="flex-1 min-w-0 min-h-[44px] px-2 border rounded-xl text-center dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="min-h-[44px] px-5 bg-emerald-600 text-white rounded-xl font-bold shrink-0"
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
                      className="flex items-center justify-between gap-2 p-2 bg-slate-100 dark:bg-slate-900 rounded"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.productName} x {item.quantity}
                      </span>
                      <span className="font-bold shrink-0">
                        ${(item.quantity * item.unitPriceUsd).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLineItem(idx)}
                        className="w-8 h-8 shrink-0 rounded-lg text-red-600 hover:bg-red-50 font-bold"
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
                className="min-h-[44px] px-4 py-2 border rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="min-h-[44px] px-5 py-2 bg-emerald-600 disabled:bg-slate-400 text-white font-semibold rounded-xl"
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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, CheckCircle2, AlertTriangle, FileText, Download } from 'lucide-react';
import { ReceiptData } from '../api';
import {
  printInvoicePdf,
  downloadInvoicePdf,
  printThermalReceiptElement,
} from '../services/receiptPdf';

interface ReceiptPreviewModalProps {
  receipt: ReceiptData;
  onCloseAndNewSale: () => void;
}

/**
 * Multi-Format Receipt & Invoice Center
 * Supports:
 * 1. Clean, isolated Thermal Receipt printing (58mm & 80mm) without phantom/duplicate pages.
 * 2. Official A4 Tax Invoice / Receipt PDF with company logo, dual currency, and signatures.
 */
export const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  receipt,
  onCloseAndNewSale,
}) => {
  const { t } = useTranslation();
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('80mm');

  const handlePrintThermal = () => {
    printThermalReceiptElement('baxnaano-thermal-receipt');
  };

  const handlePrintA4Invoice = () => {
    printInvoicePdf(receipt);
  };

  const handleDownloadA4Pdf = () => {
    downloadInvoicePdf(receipt);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
        {/* Controls (Hidden when printing) */}
        <div className="print:hidden flex flex-wrap items-center justify-between gap-3 border-b dark:border-slate-700 pb-4">
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-lg">
            <CheckCircle2 className="w-6 h-6" />
            {t('pos.receipt.title')}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaperWidth('58mm')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                paperWidth === '58mm'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-100 dark:bg-slate-700'
              }`}
            >
              {t('pos.receipt.width_58mm')}
            </button>
            <button
              type="button"
              onClick={() => setPaperWidth('80mm')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                paperWidth === '80mm'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-100 dark:bg-slate-700'
              }`}
            >
              {t('pos.receipt.width_80mm')}
            </button>
          </div>
        </div>

        {/* Thermal Receipt Printable Canvas */}
        <div
          id="baxnaano-thermal-receipt"
          className={`mx-auto bg-white text-black font-mono text-xs p-4 border border-dashed border-slate-300 shadow-inner ${
            paperWidth === '58mm' ? 'w-[220px]' : 'w-[302px]'
          }`}
        >
          {/* Branch Header with Logo */}
          <div className="text-center border-b border-dashed border-black pb-2 mb-2">
            <img
              src="/baxnaano-logo.jpg"
              alt="Baxnaano Logo"
              className="w-14 h-14 rounded-full object-cover mx-auto mb-1.5 border border-slate-200"
            />
            <div className="font-extrabold text-sm uppercase">
              {receipt.receiptHeader || receipt.branchName || 'BAXNAANO PHARMACY & CLINIC'}
            </div>
            <div className="text-[11px]">{receipt.branchLocation} | Code: {receipt.branchCode}</div>
            <div className="text-[10px] mt-0.5">
              {t('pos.receipt.receipt_no')}: <strong>{receipt.receiptNumber}</strong>
            </div>
            <div className="text-[10px]">
              {t('pos.receipt.date')}: {new Date(receipt.soldAt).toLocaleString()}
            </div>
            <div className="text-[10px]">
              {t('pos.receipt.cashier')}: {receipt.cashierName}
            </div>
            {receipt.customerName && (
              <div className="text-[10px] font-bold">
                {t('pos.receipt.customer')}: {receipt.customerName} ({receipt.customerPhone || ''})
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="border-b border-dashed border-black pb-2 mb-2 space-y-1.5">
            {receipt.items.map((item, idx) => (
              <div key={idx} className="leading-tight">
                <div className="font-bold flex justify-between">
                  <span>{item.productName}</span>
                  <span>${item.subtotalUsd.toFixed(2)}</span>
                </div>
                <div className="text-[10px] text-neutral-700 flex justify-between">
                  <span>
                    {item.quantity} x ${item.unitPriceUsd.toFixed(2)} [{t('pos.receipt.batch')}: #{item.batchNumber}]
                  </span>
                  {item.discountUsd > 0 && <span>(-${item.discountUsd.toFixed(2)})</span>}
                </div>
                {item.dosageNote && (
                  <div className="text-[10px] italic mt-0.5">* {item.dosageNote}</div>
                )}
                {item.withdrawalPeriodDays && item.withdrawalPeriodDays > 0 && (
                  <div className="text-[10px] font-bold flex items-center gap-1 mt-0.5 text-amber-800">
                    <AlertTriangle className="w-3 h-3 inline" />
                    {t('pos.receipt.withdrawal_warning', { days: item.withdrawalPeriodDays })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Totals (USD & SLSH Dual Display) */}
          <div className="border-b border-dashed border-black pb-2 mb-2 space-y-0.5">
            <div className="flex justify-between">
              <span>{t('pos.subtotal')}:</span>
              <span>${receipt.subtotalUsd.toFixed(2)}</span>
            </div>
            {receipt.discountUsd > 0 && (
              <div className="flex justify-between">
                <span>{t('pos.discount_usd')}:</span>
                <span>-${receipt.discountUsd.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-extrabold text-sm pt-1">
              <span>{t('pos.total_usd')}:</span>
              <span>${receipt.totalUsd.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-[11px]">
              <span>{t('pos.total_slsh')}:</span>
              <span>{receipt.totalSlsh.toLocaleString()} SLSH</span>
            </div>
            <div className="text-[9px] text-neutral-600 text-right">
              (Rate: 1 USD = {receipt.exchangeRateUsed.toLocaleString()} SLSH)
            </div>
          </div>

          {/* Split Payments Breakdown */}
          <div className="border-b border-dashed border-black pb-2 mb-2 space-y-0.5 text-[10px]">
            <div className="font-bold uppercase">{t('pos.payment_section')}:</div>
            {receipt.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>
                  {t(`pos.methods.${p.method}`)} ({p.currency})
                </span>
                <span>
                  {p.currency === 'USD'
                    ? `$${p.amountOriginal.toFixed(2)}`
                    : `${p.amountOriginal.toLocaleString()} SLSH ($${p.amountUsd.toFixed(2)})`}
                </span>
              </div>
            ))}
            <div className="flex justify-between font-bold pt-1">
              <span>{t('pos.receipt.paid')}:</span>
              <span>${receipt.paidUsd.toFixed(2)}</span>
            </div>
            {receipt.creditAmountUsd > 0 && (
              <div className="flex justify-between font-bold text-red-600">
                <span>{t('pos.receipt.credit_due')}:</span>
                <span>${receipt.creditAmountUsd.toFixed(2)}</span>
              </div>
            )}
            {receipt.changeUsd > 0 && (
              <div className="flex justify-between">
                <span>{t('pos.receipt.change')}:</span>
                <span>
                  ${receipt.changeUsd.toFixed(2)} (
                  {Math.round(receipt.changeUsd * receipt.exchangeRateUsed).toLocaleString()} SLSH)
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-[10px] pt-1">
            <div>{receipt.receiptFooter || t('pos.receipt.footer_thanks')}</div>
          </div>
        </div>

        {/* Action Buttons (Hidden when printing) */}
        <div className="print:hidden space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handlePrintThermal}
              className="min-h-[44px] px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold rounded-xl flex items-center justify-center gap-1.5 text-xs hover:opacity-90"
            >
              <Printer className="w-4 h-4" />
              {t('pos.receipt.print_thermal')}
            </button>
            <button
              type="button"
              onClick={handlePrintA4Invoice}
              className="min-h-[44px] px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center gap-1.5 text-xs"
            >
              <FileText className="w-4 h-4" />
              A4 Tax Invoice (PDF)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadA4Pdf}
              className="min-h-[44px] flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl flex items-center justify-center gap-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Download className="w-4 h-4" />
              Download A4 PDF
            </button>
            <button
              type="button"
              onClick={onCloseAndNewSale}
              className="min-h-[44px] flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs"
            >
              {t('pos.receipt.new_sale')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

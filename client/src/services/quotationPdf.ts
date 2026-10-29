import { jsPDF } from 'jspdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';

interface QuotationLine {
  productName: string;
  sku?: string;
  quantity: number;
  unitPriceUsd: number;
}

/**
 * Builds an A4 quotation PDF entirely from data (no DOM / CSS print dependency),
 * so it is never blank and works offline.
 */
export function buildQuotationPdf(q: Record<string, unknown>): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const rate = Number(q.exchangeRateUsed || 10000);
  const items = ((q.items as QuotationLine[]) || []).map((i) => ({
    ...i,
    quantity: Number(i.quantity),
    unitPriceUsd: Number(i.unitPriceUsd),
  }));

  const branch = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === q.branchId || b.code === q.branchId
  );

  // Header band
  doc.setFillColor(5, 150, 105);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('BAXNAANO', margin, 12);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Pharmacy & Veterinary Clinic', margin, 18);
  if (branch) doc.text(`${branch.name} - ${branch.location}`, margin, 23);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('QUOTATION', pageW - margin, 14, { align: 'right' });
  doc.setFontSize(10);
  doc.text(String(q.quotationNumber || ''), pageW - margin, 21, { align: 'right' });

  // Meta
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let y = 40;
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(q.customerName || 'Walk-in'), margin + 24, y);
  y += 6;
  if (q.customerPhone) {
    doc.setFont('helvetica', 'bold');
    doc.text('Phone:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(q.customerPhone), margin + 24, y);
    y += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(q.createdAt || new Date().toISOString()).slice(0, 10), margin + 24, y);
  doc.setFont('helvetica', 'bold');
  doc.text('Valid Until:', pageW / 2 + 10, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(q.validUntil || '').slice(0, 10), pageW / 2 + 36, y);
  y += 10;

  // Table header
  const colNo = margin + 2;
  const colName = margin + 12;
  const colQty = pageW - margin - 60;
  const colPrice = pageW - margin - 38;
  const colTotal = pageW - margin - 2;

  const drawTableHeader = (yy: number) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, yy - 5, pageW - margin * 2, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('#', colNo, yy);
    doc.text('Item', colName, yy);
    doc.text('Qty', colQty, yy, { align: 'right' });
    doc.text('Unit (USD)', colPrice, yy, { align: 'right' });
    doc.text('Total (USD)', colTotal, yy, { align: 'right' });
    return yy + 8;
  };

  y = drawTableHeader(y);
  doc.setFont('helvetica', 'normal');
  items.forEach((item, idx) => {
    if (y > 265) {
      doc.addPage();
      y = drawTableHeader(20);
      doc.setFont('helvetica', 'normal');
    }
    const nameLines = doc.splitTextToSize(String(item.productName), colQty - colName - 14);
    doc.setFontSize(9);
    doc.text(String(idx + 1), colNo, y);
    doc.text(nameLines, colName, y);
    doc.text(String(item.quantity), colQty, y, { align: 'right' });
    doc.text(item.unitPriceUsd.toFixed(2), colPrice, y, { align: 'right' });
    doc.text((item.quantity * item.unitPriceUsd).toFixed(2), colTotal, y, { align: 'right' });
    y += Math.max(6, nameLines.length * 4.5 + 2);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y - 3, pageW - margin, y - 3);
  });

  // Totals
  if (y > 250) {
    doc.addPage();
    y = 25;
  }
  y += 4;
  const subtotal = Number(q.subtotalUsd ?? items.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0));
  const discount = Number(q.discountUsd || 0);
  const totalUsd = Number(q.totalUsd ?? subtotal - discount);
  const totalSlsh = Number(q.totalSlsh ?? Math.round(totalUsd * rate));

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', colPrice - 10, y, { align: 'right' });
  doc.text(`$${subtotal.toFixed(2)}`, colTotal, y, { align: 'right' });
  if (discount > 0) {
    y += 6;
    doc.text('Discount:', colPrice - 10, y, { align: 'right' });
    doc.text(`-$${discount.toFixed(2)}`, colTotal, y, { align: 'right' });
  }
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(5, 150, 105);
  doc.text('TOTAL (USD):', colPrice - 10, y, { align: 'right' });
  doc.text(`$${totalUsd.toFixed(2)}`, colTotal, y, { align: 'right' });
  y += 7;
  doc.setFontSize(10);
  doc.text(`TOTAL (SLSH): ${totalSlsh.toLocaleString('en-US')}`, colTotal, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Exchange rate: 1 USD = ${rate.toLocaleString('en-US')} SLSH`, colTotal, y, {
    align: 'right',
  });

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Thank you for choosing Baxnaano! / Mahadsanid! - This quotation is valid until the date shown above.',
    pageW / 2,
    287,
    { align: 'center' }
  );

  return doc;
}

export function quotationPdfFileName(q: Record<string, unknown>): string {
  return `Quotation-${String(q.quotationNumber || 'QTN')}.pdf`;
}

/** Opens the real PDF so the user can print or "Save as PDF" from the viewer. */
export function printQuotationPdf(q: Record<string, unknown>): void {
  const doc = buildQuotationPdf(q);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked (some mobile browsers) -> download instead
    doc.save(quotationPdfFileName(q));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Shares the quotation as a PDF file (WhatsApp on phones) or downloads + opens WhatsApp chat. */
export async function shareQuotationPdfWhatsApp(q: Record<string, unknown>): Promise<void> {
  const doc = buildQuotationPdf(q);
  const fileName = quotationPdfFileName(q);
  const blob = doc.output('blob');
  const file = new File([blob], fileName, { type: 'application/pdf' });
  const text = `Baxnaano Quotation ${String(q.quotationNumber || '')} - Total $${Number(
    q.totalUsd || 0
  ).toFixed(2)}`;

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };

  if (nav.canShare && nav.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: fileName, text });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // fall through to download fallback
    }
  }

  // Desktop fallback: download the PDF, then open WhatsApp chat so it can be attached
  doc.save(fileName);
  const phone = String(q.customerPhone || '').replace(/[^0-9]/g, '');
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text + ' (PDF attached)')}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}


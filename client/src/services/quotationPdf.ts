import { jsPDF } from 'jspdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { BAXNAANO_LOGO_BASE64 } from '../assets/logoBase64';

interface QuotationLine {
  productName: string;
  sku?: string;
  quantity: number;
  unitPriceUsd: number;
}

/**
 * Builds an official A4 quotation PDF with company logo, professional corporate layout,
 * Somaliland dual-currency rates, terms, and signature lines.
 */
export function buildQuotationPdf(q: Record<string, unknown>): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  const rate = Number(q.exchangeRateUsed || 10000);
  const items = ((q.items as QuotationLine[]) || []).map((i) => ({
    ...i,
    quantity: Number(i.quantity),
    unitPriceUsd: Number(i.unitPriceUsd),
  }));

  const branch = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === q.branchId || b.code === q.branchId
  );

  // 1. Company Logo & Top Header
  try {
    doc.addImage(BAXNAANO_LOGO_BASE64, 'JPEG', margin, 10, 22, 22);
  } catch (err) {
    console.warn('Could not add logo to quotation PDF:', err);
  }

  // Company Information
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('BAXNAANO PHARMACY & VETERINARY CLINIC', margin + 26, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // slate-600
  const branchName = branch ? `${branch.name} (${branch.code})` : 'All Branches / Central';
  const branchLoc = branch ? branch.location : 'Somaliland';
  doc.text(`Branch: ${branchName} | Location: ${branchLoc}`, margin + 26, 22);
  doc.text('Tel: +252 63 4400000 / +252 63 4422222 | Somaliland', margin + 26, 27);
  doc.text('Email: info@baxnaano.com | Web: baxnaanosystem.onrender.com', margin + 26, 31);

  // Right-aligned Quotation Document Title Box
  doc.setFillColor(5, 150, 105); // emerald-600
  doc.roundedRect(pageW - margin - 52, 11, 52, 10, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PRICE QUOTATION', pageW - margin - 26, 17.5, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.text(`Quote #: ${String(q.quotationNumber || 'QTN-DRAFT')}`, pageW - margin, 25, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Date: ${String(q.createdAt || new Date().toISOString()).slice(0, 10)}`, pageW - margin, 29.5, { align: 'right' });
  const validUntilStr = String(q.validUntil || '').slice(0, 10);
  if (validUntilStr) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(`Valid Until: ${validUntilStr}`, pageW - margin, 34, { align: 'right' });
  }

  // Accent horizontal divider
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.8);
  doc.line(margin, 37, pageW - margin, 37);

  // 2. Customer & Quotation Details Box
  let y = 43;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, 20, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('QUOTED TO / CUSTOMER:', margin + 4, y + 5);
  doc.text('PAYMENT & EXCHANGE TERMS:', pageW / 2 + 6, y + 5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(String(q.customerName || 'Valued Customer / Walk-in'), margin + 4, y + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Phone: ${String(q.customerPhone || 'N/A')}`, margin + 4, y + 15.5);

  doc.text(`Currency: Dual USD ($) & SLSH`, pageW / 2 + 6, y + 10.5);
  doc.text(`Exchange Rate: 1 USD = ${rate.toLocaleString()} SLSH`, pageW / 2 + 6, y + 15.5);

  y += 26;

  // 3. Line Items Table
  const colNo = margin + 3;
  const colName = margin + 12;
  const colQty = pageW - margin - 58;
  const colPrice = pageW - margin - 34;
  const colTotal = pageW - margin - 4;

  const drawTableHeader = (yy: number) => {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(margin, yy - 5, contentW, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('#', colNo, yy);
    doc.text('Item Description / Medicine', colName, yy);
    doc.text('Qty', colQty, yy, { align: 'right' });
    doc.text('Unit Price ($)', colPrice, yy, { align: 'right' });
    doc.text('Total (USD)', colTotal, yy, { align: 'right' });
    return yy + 7;
  };

  y = drawTableHeader(y);
  doc.setFont('helvetica', 'normal');

  items.forEach((item, idx) => {
    if (y > pageH - 45) {
      doc.addPage();
      y = drawTableHeader(20);
      doc.setFont('helvetica', 'normal');
    }

    // Alternating row background
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 4, contentW, 6.5, 'F');
    }

    const nameLines = doc.splitTextToSize(String(item.productName), colQty - colName - 8);
    const rowHeight = Math.max(6, nameLines.length * 4.2 + 2);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8.5);
    doc.text(String(idx + 1), colNo, y);
    doc.text(nameLines, colName, y);
    doc.text(String(item.quantity), colQty, y, { align: 'right' });
    doc.text(`$${item.unitPriceUsd.toFixed(2)}`, colPrice, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`$${(item.quantity * item.unitPriceUsd).toFixed(2)}`, colTotal, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += rowHeight;
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 2, pageW - margin, y - 2);
  });

  // 4. Totals Block & Summary
  if (y > pageH - 65) {
    doc.addPage();
    y = 20;
  }

  y += 4;
  const subtotal = Number(q.subtotalUsd ?? items.reduce((s, i) => s + i.quantity * i.unitPriceUsd, 0));
  const discount = Number(q.discountUsd || 0);
  const totalUsd = Number(q.totalUsd ?? subtotal - discount);
  const totalSlsh = Number(q.totalSlsh ?? Math.round(totalUsd * rate));

  // Left side: Notes & Terms
  const leftW = contentW * 0.52;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, leftW, 36, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('TERMS & CONDITIONS:', margin + 3, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('1. This quotation is valid until the date indicated above.', margin + 3, y + 10);
  doc.text('2. Prices are based on current stock availability & exchange rate.', margin + 3, y + 15);
  doc.text('3. Payment accepted via Cash (USD/SLSH), Telesom ZAAD, Somtel SAHAL, EVC.', margin + 3, y + 20);
  doc.text('4. Quality assured by Baxnaano Veterinary & Pharmaceutical team.', margin + 3, y + 25);
  doc.text('Mahadsanid! / Thank you for choosing Baxnaano!', margin + 3, y + 31);

  // Right side: Totals Box
  const rightX = margin + leftW + 4;
  const rightW = contentW - leftW - 4;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(rightX, y, rightW, 36, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Subtotal:', rightX + 4, y + 6);
  doc.text(`$${subtotal.toFixed(2)}`, pageW - margin - 4, y + 6, { align: 'right' });

  if (discount > 0) {
    doc.text('Discount:', rightX + 4, y + 11.5);
    doc.setTextColor(220, 38, 38);
    doc.text(`-$${discount.toFixed(2)}`, pageW - margin - 4, y + 11.5, { align: 'right' });
    doc.setTextColor(71, 85, 105);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(rightX + 2, y + 15.5, pageW - margin - 2, y + 15.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(5, 150, 105); // emerald-600
  doc.text('TOTAL DUE (USD):', rightX + 4, y + 21);
  doc.text(`$${totalUsd.toFixed(2)}`, pageW - margin - 4, y + 21, { align: 'right' });

  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL (SLSH):', rightX + 4, y + 26.5);
  doc.text(`${totalSlsh.toLocaleString()} SLSH`, pageW - margin - 4, y + 26.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Rate: 1 USD = ${rate.toLocaleString()} SLSH`, pageW - margin - 4, y + 32, { align: 'right' });

  // 5. Sign-off / Signature Lines
  y += 44;
  if (y > pageH - 25) {
    doc.addPage();
    y = 25;
  }

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, y + 8, margin + 65, y + 8);
  doc.line(pageW - margin - 65, y + 8, pageW - margin - 5, y + 8);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Prepared By (Officer)', margin + 35, y + 12, { align: 'center' });
  doc.text('Authorized Signature & Official Stamp', pageW - margin - 35, y + 12, { align: 'center' });

  // Bottom footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `Baxnaano Multi-Branch Management System • Generated on ${new Date().toLocaleDateString()}`,
      margin,
      pageH - 6
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  return doc;
}

export function quotationPdfFileName(q: Record<string, unknown>): string {
  return `Quotation-${String(q.quotationNumber || 'QTN')}.pdf`;
}

/** Opens the real PDF in browser tab or triggers download */
export function printQuotationPdf(q: Record<string, unknown>): void {
  const doc = buildQuotationPdf(q);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    doc.save(quotationPdfFileName(q));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Shares quotation as PDF directly to WhatsApp */
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
    }
  }

  doc.save(fileName);
  const phone = String(q.customerPhone || '').replace(/[^0-9]/g, '');
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text + ' (PDF attached)')}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

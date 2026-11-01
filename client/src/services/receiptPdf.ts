import { jsPDF } from 'jspdf';
import { ReceiptData } from '../api';
import { BAXNAANO_LOGO_BASE64 } from '../assets/logoBase64';

/**
 * Builds an official, publication-quality A4 Tax Invoice / Receipt PDF
 * complete with company logo, dual currency (USD & SLSH), split payment breakdown,
 * veterinary warnings, batch tracking, and official stamp/signature lines.
 */
export function buildInvoicePdf(receipt: ReceiptData): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  const rate = Number(receipt.exchangeRateUsed || 10000);

  // 1. Company Logo & Top Header
  try {
    doc.addImage(BAXNAANO_LOGO_BASE64, 'JPEG', margin, 10, 22, 22);
  } catch (err) {
    console.warn('Could not add logo to invoice PDF:', err);
  }

  // Company Brand Header
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('BAXNAANO PHARMACY & VETERINARY CLINIC', margin + 26, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // slate-600
  const branchName = receipt.branchName || 'Central Branch';
  const branchLoc = receipt.branchLocation || 'Somaliland';
  const branchCode = receipt.branchCode || 'B1';
  doc.text(`${branchName} (${branchCode}) • ${branchLoc}`, margin + 26, 22);
  doc.text('Tel: +252 63 4400000 / +252 63 4422222 | Somaliland', margin + 26, 27);
  doc.text('Email: info@baxnaano.com | Web: baxnaanosystem.onrender.com', margin + 26, 31);

  // Right-aligned Invoice Document Badge
  doc.setFillColor(15, 23, 42); // slate-900
  doc.roundedRect(pageW - margin - 52, 11, 52, 10, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TAX INVOICE / RECEIPT', pageW - margin - 26, 17.5, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(`Invoice #: ${receipt.receiptNumber}`, pageW - margin, 25.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Date: ${new Date(receipt.soldAt).toLocaleString()}`, pageW - margin, 30, { align: 'right' });
  doc.text(`Cashier: ${receipt.cashierName}`, pageW - margin, 34.5, { align: 'right' });

  // Accent divider
  doc.setDrawColor(5, 150, 105); // emerald-600
  doc.setLineWidth(0.8);
  doc.line(margin, 38, pageW - margin, 38);

  // 2. Customer & Transaction Meta Box
  let y = 43;
  doc.setFillColor(248, 250, 252); // slate-50
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, 19, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('CUSTOMER / BILLED TO:', margin + 4, y + 5);
  doc.text('TRANSACTION DETAILS:', pageW / 2 + 6, y + 5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9.5);
  doc.text(String(receipt.customerName || 'Walk-in Retail Customer'), margin + 4, y + 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Phone: ${String(receipt.customerPhone || 'N/A')}`, margin + 4, y + 15);

  doc.text(`Branch Code: ${branchCode} (${branchLoc})`, pageW / 2 + 6, y + 10.5);
  doc.text(`Exchange Rate Applied: 1 USD = ${rate.toLocaleString()} SLSH`, pageW / 2 + 6, y + 15);

  y += 25;

  // 3. Items Table Header
  const colNo = margin + 3;
  const colName = margin + 11;
  const colBatch = pageW - margin - 80;
  const colQty = pageW - margin - 52;
  const colPrice = pageW - margin - 30;
  const colTotal = pageW - margin - 3;

  const drawTableHeader = (yy: number) => {
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(margin, yy - 5, contentW, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('#', colNo, yy);
    doc.text('Item Description / Medicine', colName, yy);
    doc.text('Batch #', colBatch, yy);
    doc.text('Qty', colQty, yy, { align: 'right' });
    doc.text('Price ($)', colPrice, yy, { align: 'right' });
    doc.text('Total (USD)', colTotal, yy, { align: 'right' });
    return yy + 7;
  };

  y = drawTableHeader(y);
  doc.setFont('helvetica', 'normal');

  receipt.items.forEach((item, idx) => {
    if (y > pageH - 55) {
      doc.addPage();
      y = drawTableHeader(20);
      doc.setFont('helvetica', 'normal');
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 4, contentW, 6.5, 'F');
    }

    const nameLines = doc.splitTextToSize(String(item.productName), colBatch - colName - 4);
    const rowHeight = Math.max(6, nameLines.length * 4.2 + (item.withdrawalPeriodDays || item.dosageNote ? 4.5 : 2));

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8.5);
    doc.text(String(idx + 1), colNo, y);
    doc.text(nameLines, colName, y);
    doc.setFontSize(7.5);
    doc.text(item.batchNumber ? `#${item.batchNumber}` : '—', colBatch, y);
    doc.setFontSize(8.5);
    doc.text(String(item.quantity), colQty, y, { align: 'right' });
    doc.text(`$${item.unitPriceUsd.toFixed(2)}`, colPrice, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(`$${item.subtotalUsd.toFixed(2)}`, colTotal, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    let extraY = y + nameLines.length * 4.2;
    if (item.dosageNote) {
      doc.setFontSize(7.5);
      doc.setTextColor(71, 85, 105);
      doc.text(`* Dosage: ${item.dosageNote}`, colName, extraY);
      extraY += 4;
    }
    if (item.withdrawalPeriodDays && item.withdrawalPeriodDays > 0) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(180, 83, 9); // amber-700
      doc.text(`⚠️ Vet Withdrawal Period: ${item.withdrawalPeriodDays} days`, colName, extraY);
      doc.setFont('helvetica', 'normal');
    }

    y += rowHeight;
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 2, pageW - margin, y - 2);
  });

  // 4. Split Payment & Summary Totals Block
  if (y > pageH - 70) {
    doc.addPage();
    y = 20;
  }

  y += 4;
  const leftW = contentW * 0.52;
  const rightX = margin + leftW + 4;
  const rightW = contentW - leftW - 4;

  // Left Box: Payment Methods Breakdown
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, leftW, 40, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('PAYMENT SETTLEMENT BREAKDOWN:', margin + 4, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  let py = y + 10;
  receipt.payments.forEach((p) => {
    const methodStr = `${p.method} (${p.currency})`;
    const amtStr =
      p.currency === 'USD'
        ? `$${p.amountOriginal.toFixed(2)}`
        : `${Number(p.amountOriginal).toLocaleString()} SLSH ($${p.amountUsd.toFixed(2)})`;
    doc.text(methodStr, margin + 4, py);
    doc.text(amtStr, margin + leftW - 4, py, { align: 'right' });
    py += 4.5;
  });

  doc.setDrawColor(226, 232, 240);
  doc.line(margin + 3, y + 26, margin + leftW - 3, y + 26);

  doc.setFont('helvetica', 'bold');
  doc.text('Total Paid:', margin + 4, y + 30.5);
  doc.text(`$${receipt.paidUsd.toFixed(2)}`, margin + leftW - 4, y + 30.5, { align: 'right' });

  if (receipt.changeUsd > 0) {
    doc.setFont('helvetica', 'normal');
    doc.text('Change Returned:', margin + 4, y + 35);
    doc.text(
      `$${receipt.changeUsd.toFixed(2)} (${Math.round(receipt.changeUsd * rate).toLocaleString()} SLSH)`,
      margin + leftW - 4,
      y + 35,
      { align: 'right' }
    );
  } else if (receipt.creditAmountUsd > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text('Balance Added to Credit:', margin + 4, y + 35);
    doc.text(`$${receipt.creditAmountUsd.toFixed(2)}`, margin + leftW - 4, y + 35, { align: 'right' });
    doc.setTextColor(71, 85, 105);
  }

  // Right Box: Financial Totals
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(rightX, y, rightW, 40, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Subtotal:', rightX + 4, y + 6);
  doc.text(`$${receipt.subtotalUsd.toFixed(2)}`, pageW - margin - 4, y + 6, { align: 'right' });

  if (receipt.discountUsd > 0) {
    doc.text('Discount:', rightX + 4, y + 11.5);
    doc.setTextColor(220, 38, 38);
    doc.text(`-$${receipt.discountUsd.toFixed(2)}`, pageW - margin - 4, y + 11.5, { align: 'right' });
    doc.setTextColor(71, 85, 105);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(rightX + 2, y + 16, pageW - margin - 2, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(5, 150, 105); // emerald-600
  doc.text('TOTAL DUE (USD):', rightX + 4, y + 22);
  doc.text(`$${receipt.totalUsd.toFixed(2)}`, pageW - margin - 4, y + 22, { align: 'right' });

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL (SLSH):', rightX + 4, y + 28);
  doc.text(`${receipt.totalSlsh.toLocaleString()} SLSH`, pageW - margin - 4, y + 28, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Rate: 1 USD = ${rate.toLocaleString()} SLSH`, pageW - margin - 4, y + 35, { align: 'right' });

  // 5. Sign-off / Terms Line
  y += 48;
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
  doc.text(`Cashier / Dispenser: ${receipt.cashierName}`, margin + 35, y + 12, { align: 'center' });
  doc.text('Authorized Signature & Stamp', pageW - margin - 35, y + 12, { align: 'center' });

  // Bottom footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Baxnaano Multi-Branch System • Thank you for choosing Baxnaano! / Mahadsanid!`,
      margin,
      pageH - 6
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  return doc;
}

export function invoicePdfFileName(receipt: ReceiptData): string {
  return `Invoice-${receipt.receiptNumber || 'REC'}.pdf`;
}

/** Opens the A4 Invoice PDF in browser viewer or prints */
export function printInvoicePdf(receipt: ReceiptData): void {
  const doc = buildInvoicePdf(receipt);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    doc.save(invoicePdfFileName(receipt));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the A4 invoice PDF directly */
export function downloadInvoicePdf(receipt: ReceiptData): void {
  const doc = buildInvoicePdf(receipt);
  doc.save(invoicePdfFileName(receipt));
}

/**
 * Robust thermal receipt printer using a hidden iframe.
 * Isolates the receipt DOM so that the browser print dialog
 * prints strictly 1 page without printing the background page or producing 5 pages.
 */
export function printThermalReceiptElement(elementId = 'baxnaano-thermal-receipt'): void {
  const receiptEl = document.getElementById(elementId);
  if (!receiptEl) {
    window.print();
    return;
  }

  // Remove any stale print iframes
  const existingIframe = document.getElementById('baxnaano-print-frame');
  if (existingIframe) {
    existingIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'baxnaano-print-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    window.print();
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt</title>
        <style>
          @page {
            margin: 0;
            size: auto;
          }
          html, body {
            margin: 0 !important;
            padding: 4px !important;
            font-family: monospace, Courier, sans-serif !important;
            background: #fff !important;
            color: #000 !important;
          }
          * {
            box-sizing: border-box;
          }
          img {
            max-width: 100%;
            height: auto;
          }
          #${elementId} {
            width: 100% !important;
            max-width: 300px !important;
            margin: 0 auto !important;
            border: none !important;
            box-shadow: none !important;
          }
        </style>
      </head>
      <body>
        ${receiptEl.outerHTML}
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn('Iframe print error, falling back to window.print():', err);
      window.print();
    } finally {
      setTimeout(() => {
        iframe.remove();
      }, 1500);
    }
  }, 250);
}


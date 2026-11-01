import { jsPDF } from 'jspdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { BAXNAANO_LOGO_BASE64 } from '../assets/logoBase64';

export interface StatementEntry {
  id: string;
  createdAt: string;
  type: string;
  notes?: string;
  amountDeltaUsd: number;
  balanceAfterUsd: number;
}

export interface StatementCustomer {
  id: string;
  name: string;
  phone: string;
  branchId?: string;
  currentBalanceUsd: number;
  creditLimitUsd?: number;
  entries: StatementEntry[];
}

/**
 * Builds an official A4 Customer Credit Statement PDF with company logo,
 * balance breakdown (USD & SLSH), running ledger, and verification signature.
 */
export function buildStatementPdf(
  customer: StatementCustomer,
  branchCodeOrId?: string,
  exchangeRate = 10000
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  const branch = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === (customer.branchId || branchCodeOrId) || b.code === (customer.branchId || branchCodeOrId)
  );
  const branchName = branch ? `${branch.name} (${branch.code}) • ${branch.location}` : 'Central Office';

  // 1. Company Logo & Top Header
  try {
    doc.addImage(BAXNAANO_LOGO_BASE64, 'JPEG', margin, 10, 22, 22);
  } catch (err) {
    console.warn('Could not add logo to statement PDF:', err);
  }

  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('BAXNAANO PHARMACY & VETERINARY CLINIC', margin + 26, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Branch: ${branchName}`, margin + 26, 22);
  doc.text('Tel: +252 63 4400000 / +252 63 4422222 | Somaliland', margin + 26, 27);
  doc.text('Email: info@baxnaano.com | Web: baxnaanosystem.onrender.com', margin + 26, 31);

  // Statement Badge
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(pageW - margin - 56, 11, 56, 10, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('CUSTOMER STATEMENT', pageW - margin - 28, 17.5, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(8.5);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageW - margin, 26, { align: 'right' });
  doc.text(`Ref #: STM-${customer.id.slice(0, 8).toUpperCase()}`, pageW - margin, 31, { align: 'right' });

  // Accent line
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.8);
  doc.line(margin, 38, pageW - margin, 38);

  // 2. Customer Profile & Outstanding Balance Box
  let y = 43;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, 22, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('ACCOUNT HOLDER / CUSTOMER:', margin + 4, y + 5.5);
  doc.text('CURRENT OUTSTANDING BALANCE:', pageW / 2 + 6, y + 5.5);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(String(customer.name), margin + 4, y + 11.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Phone: ${customer.phone || 'N/A'}`, margin + 4, y + 16.5);

  const balanceUsd = Number(customer.currentBalanceUsd || 0);
  const balanceSlsh = Math.round(balanceUsd * exchangeRate);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(balanceUsd > 0 ? 220 : 5, balanceUsd > 0 ? 38 : 150, balanceUsd > 0 ? 38 : 105);
  doc.text(`$${balanceUsd.toFixed(2)} USD`, pageW / 2 + 6, y + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Equivalent: ${balanceSlsh.toLocaleString()} SLSH (Rate: 1 USD = ${exchangeRate.toLocaleString()} SLSH)`,
    pageW / 2 + 6,
    y + 17
  );

  y += 28;

  // 3. Ledger Transactions Table
  const colDate = margin + 3;
  const colType = margin + 26;
  const colNotes = margin + 55;
  const colDelta = pageW - margin - 32;
  const colBal = pageW - margin - 3;

  const drawTableHeader = (yy: number) => {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, yy - 5, contentW, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('Date', colDate, yy);
    doc.text('Type', colType, yy);
    doc.text('Description / Notes', colNotes, yy);
    doc.text('Amount ($)', colDelta, yy, { align: 'right' });
    doc.text('Balance ($)', colBal, yy, { align: 'right' });
    return yy + 7;
  };

  y = drawTableHeader(y);
  doc.setFont('helvetica', 'normal');

  if (!customer.entries || customer.entries.length === 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('No ledger transactions recorded for this customer.', margin + 4, y + 6);
    y += 12;
  } else {
    customer.entries.forEach((entry, idx) => {
      if (y > pageH - 45) {
        doc.addPage();
        y = drawTableHeader(20);
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 4, contentW, 6.5, 'F');
      }

      const noteStr = String(entry.notes || '—');
      const noteLines = doc.splitTextToSize(noteStr, colDelta - colNotes - 8);
      const rowHeight = Math.max(6, noteLines.length * 4.2 + 2);

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      doc.text(String(entry.createdAt).slice(0, 10), colDate, y);

      const isPayment = String(entry.type).toUpperCase().includes('PAYMENT');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(isPayment ? 5 : 15, isPayment ? 150 : 23, isPayment ? 105 : 42);
      doc.text(String(entry.type), colType, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(noteLines, colNotes, y);

      const delta = Number(entry.amountDeltaUsd || 0);
      doc.setFont('helvetica', 'bold');
      if (delta < 0) {
        doc.setTextColor(5, 150, 105);
        doc.text(`-$${Math.abs(delta).toFixed(2)}`, colDelta, y, { align: 'right' });
      } else {
        doc.setTextColor(220, 38, 38);
        doc.text(`+$${delta.toFixed(2)}`, colDelta, y, { align: 'right' });
      }

      doc.setTextColor(15, 23, 42);
      doc.text(`$${Number(entry.balanceAfterUsd || 0).toFixed(2)}`, colBal, y, { align: 'right' });

      y += rowHeight;
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.2);
      doc.line(margin, y - 2, pageW - margin, y - 2);
    });
  }

  // 4. Sign-off & Terms
  if (y > pageH - 40) {
    doc.addPage();
    y = 20;
  }

  y += 6;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentW, 16, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    'Please review this statement carefully. Report any discrepancies to Baxnaano Finance within 7 business days.',
    margin + 4,
    y + 6
  );
  doc.text(
    'Repayments can be made at any branch in Cash (USD/SLSH), Telesom ZAAD, or Somtel SAHAL.',
    margin + 4,
    y + 11
  );

  y += 24;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, y + 8, margin + 65, y + 8);
  doc.line(pageW - margin - 65, y + 8, pageW - margin - 5, y + 8);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Prepared By (Accounts Officer)', margin + 35, y + 12, { align: 'center' });
  doc.text('Customer Acknowledgment / Signature', pageW - margin - 35, y + 12, { align: 'center' });

  // Footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Baxnaano Multi-Branch Management System • Official Customer Statement`,
      margin,
      pageH - 6
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  return doc;
}

export function statementPdfFileName(customer: StatementCustomer): string {
  return `Statement-${customer.name.replace(/[^a-zA-Z0-9]/g, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

/** Opens the Statement PDF in a new tab or triggers download */
export function printStatementPdf(customer: StatementCustomer, branchCodeOrId?: string): void {
  const doc = buildStatementPdf(customer, branchCodeOrId);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    doc.save(statementPdfFileName(customer));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the Statement PDF */
export function downloadStatementPdf(customer: StatementCustomer, branchCodeOrId?: string): void {
  const doc = buildStatementPdf(customer, branchCodeOrId);
  doc.save(statementPdfFileName(customer));
}


import { jsPDF } from 'jspdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { BAXNAANO_LOGO_BASE64 } from '../assets/logoBase64';
import {
  DashboardAnalyticsResponse,
  ServerProductWithFEFO,
  CustomerAging,
} from '../api';

interface ReportPdfOptions {
  branchId: string;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  dashData: DashboardAnalyticsResponse | null;
  products: ServerProductWithFEFO[];
  customers: CustomerAging[];
  generatedBy?: string;
}

/**
 * Builds an official A4 Executive Financial & Operational Report PDF
 * complete with company logo, KPI blocks, stock valuation, and debtor credit aging.
 */
export function buildReportPdf(opts: ReportPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  const branch = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === opts.branchId || b.code === opts.branchId
  );
  const branchName = branch
    ? `${branch.name} (${branch.code}) • ${branch.location}`
    : 'All Branches (Consolidated Enterprise Report)';

  // 1. Company Logo & Top Header
  try {
    doc.addImage(BAXNAANO_LOGO_BASE64, 'JPEG', margin, 10, 22, 22);
  } catch (err) {
    console.warn('Could not add logo to report PDF:', err);
  }

  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('BAXNAANO PHARMACY & VETERINARY CLINIC', margin + 26, 17);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Scope: ${branchName}`, margin + 26, 22);
  doc.text('Tel: +252 63 4400000 | Email: info@baxnaano.com | Somaliland', margin + 26, 27);
  doc.text('Multi-Branch Enterprise Financial & Management Accounting', margin + 26, 31);

  // Document Badge
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(pageW - margin - 58, 11, 58, 10, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('EXECUTIVE AUDIT REPORT', pageW - margin - 29, 17.5, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.text(`Period: ${opts.period} REPORT`, pageW - margin, 25.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - margin, 30, { align: 'right' });
  if (opts.generatedBy) {
    doc.text(`Prepared By: ${opts.generatedBy}`, pageW - margin, 34.5, { align: 'right' });
  }

  // Divider
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.8);
  doc.line(margin, 38, pageW - margin, 38);

  // 2. Financial Performance KPIs (4 Cards)
  let y = 43;
  const kpiW = (contentW - 9) / 4;
  const kpis = opts.dashData?.kpis;
  const revenueUsd = Number(kpis?.todaySalesUsd || 0);
  const grossProfitUsd = Number(kpis?.todayGrossProfitUsd || 0);
  const expensesUsd = Number(kpis?.todayExpensesUsd || 0);
  const netProfitUsd = Number(kpis?.todayNetProfitUsd || 0);

  const drawKpiCard = (title: string, value: string, sub: string, xPos: number, accentColor: [number, number, number]) => {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(xPos, y, kpiW, 22, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(title.toUpperCase(), xPos + 3, y + 5.5);

    doc.setFontSize(11);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text(value, xPos + 3, y + 12.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(sub, xPos + 3, y + 18);
  };

  drawKpiCard('Total Revenue', `$${revenueUsd.toFixed(2)}`, `${(revenueUsd * 10000).toLocaleString()} SLSH`, margin, [5, 150, 105]);
  drawKpiCard('Gross Profit', `$${grossProfitUsd.toFixed(2)}`, `${revenueUsd > 0 ? ((grossProfitUsd / revenueUsd) * 100).toFixed(1) : 0}% margin`, margin + kpiW + 3, [30, 41, 59]);
  drawKpiCard('Expenses', `-$${expensesUsd.toFixed(2)}`, 'Approved operating', margin + (kpiW + 3) * 2, [220, 38, 38]);
  drawKpiCard('Net Profit', `$${netProfitUsd.toFixed(2)}`, 'After expenses', margin + (kpiW + 3) * 3, [2, 132, 199]);

  y += 28;

  // 3. Stock Valuation Summary
  const stockCostValuationUsd = opts.products.reduce(
    (sum, p) => sum + p.sellableStock * Number(p.buyPriceUsd || 0),
    0
  );
  const stockRetailValuationUsd = opts.products.reduce(
    (sum, p) => sum + p.sellableStock * Number(p.sellPriceUsd || 0),
    0
  );
  const projectedMarginUsd = stockRetailValuationUsd - stockCostValuationUsd;

  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 6.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('INVENTORY & ASSET VALUATION (FEFO CONTROL)', margin + 4, y + 4.5);
  y += 6.5;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, contentW, 16, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const colValW = contentW / 4;
  doc.text('Total Catalog SKUs:', margin + 4, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${opts.products.length} Products`, margin + 4, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Stock Cost Value (Buy):', margin + colValW + 4, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`$${stockCostValuationUsd.toFixed(2)}`, margin + colValW + 4, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Stock Retail Value (Sell):', margin + colValW * 2 + 4, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(5, 150, 105);
  doc.text(`$${stockRetailValuationUsd.toFixed(2)}`, margin + colValW * 2 + 4, y + 11);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text('Projected Margin:', margin + colValW * 3 + 4, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(2, 132, 199);
  doc.text(`$${projectedMarginUsd.toFixed(2)}`, margin + colValW * 3 + 4, y + 11);

  y += 22;

  // 4. Credit Debtors & Aging Breakdown Table
  const debtors = opts.customers.filter((c) => c.currentBalanceUsd > 0);
  doc.setFillColor(15, 23, 42);
  doc.rect(margin, y, contentW, 6.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`OUTSTANDING CREDIT & AGING SCHEDULE (${debtors.length} ACTIVE DEBTORS)`, margin + 4, y + 4.5);
  y += 6.5;

  const colCustName = margin + 4;
  const colB0 = pageW - margin - 80;
  const colB30 = pageW - margin - 55;
  const colB60 = pageW - margin - 30;
  const colTotalDue = pageW - margin - 4;

  const drawAgingHeader = (yy: number) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, yy, contentW, 6, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Customer Account', colCustName, yy + 4.2);
    doc.text('0 - 30 Days', colB0, yy + 4.2, { align: 'right' });
    doc.text('31 - 60 Days', colB30, yy + 4.2, { align: 'right' });
    doc.text('60+ Days', colB60, yy + 4.2, { align: 'right' });
    doc.text('Total Due ($)', colTotalDue, yy + 4.2, { align: 'right' });
    return yy + 6;
  };

  y = drawAgingHeader(y);

  if (debtors.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('No outstanding credit balances recorded across active scope.', margin + 4, y + 6);
    y += 10;
  } else {
    debtors.slice(0, 15).forEach((d, idx) => {
      if (y > pageH - 45) {
        doc.addPage();
        y = drawAgingHeader(20);
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, 6, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(String(d.name || 'Account'), colCustName, y + 4.2);
      doc.text(`$${d.aging.bucket0to30Usd.toFixed(2)}`, colB0, y + 4.2, { align: 'right' });
      doc.text(`$${d.aging.bucket31to60Usd.toFixed(2)}`, colB30, y + 4.2, { align: 'right' });

      if (d.aging.bucket60PlusUsd > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(220, 38, 38);
      }
      doc.text(`$${d.aging.bucket60PlusUsd.toFixed(2)}`, colB60, y + 4.2, { align: 'right' });
      doc.setTextColor(30, 41, 59);

      doc.setFont('helvetica', 'bold');
      doc.text(`$${d.currentBalanceUsd.toFixed(2)}`, colTotalDue, y + 4.2, { align: 'right' });

      y += 6;
    });

    // Total Aging Row
    const totalCreditUsd = debtors.reduce((s, d) => s + d.currentBalanceUsd, 0);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentW, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('TOTAL RECOVERABLE RECEIVABLES:', colCustName, y + 4.5);
    doc.text(`$${totalCreditUsd.toFixed(2)}`, colTotalDue, y + 4.5, { align: 'right' });
    y += 10;
  }

  // 5. Audit Verification & Signature Section
  if (y > pageH - 35) {
    doc.addPage();
    y = 25;
  }

  y += 6;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, y + 10, margin + 65, y + 10);
  doc.line(pageW - margin - 65, y + 10, pageW - margin - 5, y + 10);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Prepared By: ${opts.generatedBy || 'System Auditor'}`, margin + 35, y + 14, { align: 'center' });
  doc.text('Verified By Branch Manager / Owner', pageW - margin - 35, y + 14, { align: 'center' });

  // Footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Baxnaano Multi-Branch Management System • Confidential Financial Report`,
      margin,
      pageH - 6
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  return doc;
}

export function reportPdfFileName(period: string, branchId: string): string {
  return `Baxnaano-Report-${branchId}-${period}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

/** Opens the Report PDF in a new tab or triggers download */
export function printReportPdf(opts: ReportPdfOptions): void {
  const doc = buildReportPdf(opts);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    doc.save(reportPdfFileName(opts.period, opts.branchId));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the Report PDF */
export function downloadReportPdf(opts: ReportPdfOptions): void {
  const doc = buildReportPdf(opts);
  doc.save(reportPdfFileName(opts.period, opts.branchId));
}


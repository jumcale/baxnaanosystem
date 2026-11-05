import { jsPDF } from 'jspdf';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { BAXNAANO_LOGO_BASE64 } from '../assets/logoBase64';
import {
  DashboardAnalyticsResponse,
  ServerProductWithFEFO,
  CustomerAging,
  FullFinancialReportResponse,
} from '../api';

export interface ReportPdfOptions {
  branchId: string;
  period: string;
  dashData?: DashboardAnalyticsResponse | null;
  products?: ServerProductWithFEFO[];
  customers?: CustomerAging[];
  financialReport?: FullFinancialReportResponse | null;
  generatedBy?: string;
}

/**
 * Builds an official A4 Executive Financial & Operational Report PDF
 * complete with company logo, 11 financial KPIs, branch comparison, A/R & A/P,
 * and the filtered Unified Financial Transactions Ledger.
 */
export function buildReportPdf(opts: ReportPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;

  const branch = Object.values(BAXNAANO_BRANCHES).find(
    (b) => b.id === opts.branchId || b.code === opts.branchId
  );
  const branchName = branch
    ? `${branch.name} (${branch.code}) • ${branch.location}`
    : 'All Branches (Consolidated Enterprise Report: B1, B2 & B3)';

  const rep = opts.financialReport;
  const filters = rep?.appliedFilters;

  // 1. Company Logo & Top Header
  try {
    doc.addImage(BAXNAANO_LOGO_BASE64, 'JPEG', margin, 9, 21, 21);
  } catch (err) {
    console.warn('Could not add logo to report PDF:', err);
  }

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('BAXNAANO PHARMACY & VETERINARY CLINIC', margin + 24, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Scope: ${branchName}`, margin + 24, 20);
  doc.text(
    `Timezone: Africa/Mogadishu (UTC+3) • Period: ${
      filters ? `${filters.preset} (${filters.fromDate} to ${filters.toDate})` : opts.period
    }`,
    margin + 24,
    24.5
  );
  doc.text(
    `Filters: Type=${filters?.transactionType || 'ALL'} | Method=${
      filters?.paymentMethod || 'ALL'
    } | Status=${filters?.status || 'ALL'}`,
    margin + 24,
    29
  );

  // Document Badge
  doc.setFillColor(5, 150, 105);
  doc.roundedRect(pageW - margin - 56, 9.5, 56, 9, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('FINANCIAL AUDIT REPORT', pageW - margin - 28, 15.2, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    `Mogadishu Date: ${rep?.currentMogadishuDate || new Date().toISOString().slice(0, 10)} ${
      rep?.currentMogadishuTime || ''
    }`,
    pageW - margin,
    23,
    { align: 'right' }
  );
  if (opts.generatedBy) {
    doc.text(`Prepared By: ${opts.generatedBy}`, pageW - margin, 27.5, { align: 'right' });
  }

  // Divider
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.7);
  doc.line(margin, 33, pageW - margin, 33);

  let y = 37;

  // 2. Executive Financial KPIs (Row 1 + Row 2 = 8 Primary Cards + 3 Working Capital Cards)
  const k = rep?.kpis;
  const totalRevenue = Number(k?.totalRevenueUsd ?? opts.dashData?.kpis.todaySalesUsd ?? 0);
  const totalSales = Number(k?.totalSalesUsd ?? totalRevenue);
  const totalPurchases = Number(k?.totalPurchasesUsd ?? 0);
  const totalExpenses = Number(k?.totalExpensesUsd ?? opts.dashData?.kpis.todayExpensesUsd ?? 0);
  const grossProfit = Number(k?.grossProfitUsd ?? opts.dashData?.kpis.todayGrossProfitUsd ?? 0);
  const netProfit = Number(k?.netProfitUsd ?? opts.dashData?.kpis.todayNetProfitUsd ?? 0);
  const cashBalance = Number(k?.cashBalanceUsd ?? 0);
  const netCashFlow = Number(k?.netCashFlowUsd ?? 0);
  const creditSales = Number(k?.creditSalesUsd ?? opts.dashData?.kpis.todayCreditUsd ?? 0);
  const receivables = Number(k?.outstandingReceivablesUsd ?? 0);
  const payables = Number(k?.outstandingPayablesUsd ?? 0);

  const cardW = (contentW - 9) / 4;
  const drawKpiCard = (
    title: string,
    value: string,
    sub: string,
    xPos: number,
    yPos: number,
    accent: [number, number, number]
  ) => {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(xPos, yPos, cardW, 18, 1.2, 1.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(title.toUpperCase(), xPos + 2.5, yPos + 4.8);

    doc.setFontSize(10);
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.text(value, xPos + 2.5, yPos + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(sub, xPos + 2.5, yPos + 15.5);
  };

  drawKpiCard(
    'Net Revenue',
    `$${totalRevenue.toFixed(2)}`,
    `Gross Sales: $${totalSales.toFixed(2)}`,
    margin,
    y,
    [5, 150, 105]
  );
  drawKpiCard(
    'Gross Profit',
    `$${grossProfit.toFixed(2)}`,
    `COGS: $${Number(k?.cogsUsd || 0).toFixed(2)}`,
    margin + cardW + 3,
    y,
    [15, 23, 42]
  );
  drawKpiCard(
    'Total Expenses',
    `-$${totalExpenses.toFixed(2)}`,
    `Purchases: $${totalPurchases.toFixed(2)}`,
    margin + (cardW + 3) * 2,
    y,
    [220, 38, 38]
  );
  drawKpiCard(
    'Net Profit',
    `$${netProfit.toFixed(2)}`,
    `Margin: ${Number(k?.netMarginPct || 0).toFixed(1)}%`,
    margin + (cardW + 3) * 3,
    y,
    [2, 132, 199]
  );

  y += 20.5;

  drawKpiCard(
    'Cash Balance',
    `$${cashBalance.toFixed(2)}`,
    `Flow: ${netCashFlow >= 0 ? '+' : ''}$${netCashFlow.toFixed(2)}`,
    margin,
    y,
    [5, 150, 105]
  );
  drawKpiCard(
    'Credit Sales',
    `$${creditSales.toFixed(2)}`,
    `Collections: $${Number(k?.customerPaymentsUsd || 0).toFixed(2)}`,
    margin + cardW + 3,
    y,
    [217, 119, 6]
  );
  drawKpiCard(
    'Receivables (A/R)',
    `$${receivables.toFixed(2)}`,
    `Customer Debt Due`,
    margin + (cardW + 3) * 2,
    y,
    [220, 38, 38]
  );
  drawKpiCard(
    'Payables (A/P)',
    `$${payables.toFixed(2)}`,
    `Paid Suppliers: $${Number(k?.supplierPaymentsUsd || 0).toFixed(2)}`,
    margin + (cardW + 3) * 3,
    y,
    [124, 58, 237]
  );

  y += 22;

  // 3. Multi-Branch Financial Summary (B1, B2, B3)
  if (rep && rep.branchSummaries.length > 0) {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('MULTI-BRANCH FINANCIAL COMPARISON (B1 PHARMACY, B2 VET, B3 VET)', margin + 3, y + 4.1);
    y += 6;

    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentW, 5.5, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(7.2);
    doc.text('Branch', margin + 3, y + 3.8);
    doc.text('Revenue', margin + 58, y + 3.8, { align: 'right' });
    doc.text('Purchases', margin + 82, y + 3.8, { align: 'right' });
    doc.text('Expenses', margin + 106, y + 3.8, { align: 'right' });
    doc.text('Net Profit', margin + 130, y + 3.8, { align: 'right' });
    doc.text('Cash Flow', margin + 156, y + 3.8, { align: 'right' });
    doc.text('A/R Due', pageW - margin - 2, y + 3.8, { align: 'right' });
    y += 5.5;

    rep.branchSummaries.forEach((b, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, 5.5, 'F');
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(30, 41, 59);
      doc.text(`${b.code} - ${b.name} (${b.location})`, margin + 3, y + 3.8);
      doc.setFont('helvetica', 'normal');
      doc.text(`$${b.revenueUsd.toFixed(2)}`, margin + 58, y + 3.8, { align: 'right' });
      doc.text(`$${b.purchasesUsd.toFixed(2)}`, margin + 82, y + 3.8, { align: 'right' });
      doc.text(`$${b.expensesUsd.toFixed(2)}`, margin + 106, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(`$${b.netProfitUsd.toFixed(2)}`, margin + 130, y + 3.8, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(`$${b.netCashFlowUsd.toFixed(2)}`, margin + 156, y + 3.8, { align: 'right' });
      doc.text(`$${b.receivablesUsd.toFixed(2)}`, pageW - margin - 2, y + 3.8, { align: 'right' });
      y += 5.5;
    });
    y += 4;
  }

  // 4. Unified Financial Transactions Ledger Table
  if (rep && rep.transactions.length > 0) {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, contentW, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(
      `UNIFIED FINANCIAL TRANSACTIONS LEDGER (${rep.transactions.length} RECORDS)`,
      margin + 3,
      y + 4.1
    );
    y += 6;

    const drawTxHeader = (yy: number) => {
      doc.setFillColor(241, 245, 249);
      doc.rect(margin, yy, contentW, 5.5, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.text('Date/Time', margin + 2, yy + 3.8);
      doc.text('Type', margin + 28, yy + 3.8);
      doc.text('Ref #', margin + 54, yy + 3.8);
      doc.text('Br', margin + 78, yy + 3.8);
      doc.text('Party / Description', margin + 86, yy + 3.8);
      doc.text('Method', margin + 142, yy + 3.8);
      doc.text('Net USD', margin + 166, yy + 3.8, { align: 'right' });
      doc.text('Cash Impact', pageW - margin - 2, yy + 3.8, { align: 'right' });
      return yy + 5.5;
    };

    y = drawTxHeader(y);

    rep.transactions.slice(0, 65).forEach((tx, idx) => {
      if (y > pageH - 24) {
        doc.addPage();
        y = drawTxHeader(15);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, 5.2, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(30, 41, 59);
      doc.text(`${tx.mogadishuDate.slice(5)} ${tx.mogadishuTime.slice(0, 5)}`, margin + 2, y + 3.6);
      doc.text(tx.type.slice(0, 14), margin + 28, y + 3.6);
      doc.text(tx.referenceNumber.slice(0, 14), margin + 54, y + 3.6);
      doc.text(tx.branchCode, margin + 78, y + 3.6);
      doc.text(`${tx.partyName} - ${tx.description}`.slice(0, 36), margin + 86, y + 3.6);
      doc.text(tx.paymentMethod.slice(0, 10), margin + 142, y + 3.6);

      doc.setFont('helvetica', 'bold');
      doc.text(`$${tx.netAmountUsd.toFixed(2)}`, margin + 166, y + 3.6, { align: 'right' });
      if (tx.cashImpactUsd > 0) doc.setTextColor(5, 150, 105);
      else if (tx.cashImpactUsd < 0) doc.setTextColor(220, 38, 38);
      doc.text(
        `${tx.cashImpactUsd > 0 ? '+' : ''}$${tx.cashImpactUsd.toFixed(2)}`,
        pageW - margin - 2,
        y + 3.6,
        { align: 'right' }
      );
      doc.setTextColor(30, 41, 59);
      y += 5.2;
    });
    y += 4;
  }

  // 5. Audit Verification & Signature Section
  if (y > pageH - 28) {
    doc.addPage();
    y = 22;
  }

  y += 5;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(margin + 5, y + 8, margin + 65, y + 8);
  doc.line(pageW - margin - 65, y + 8, pageW - margin - 5, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Prepared By: ${opts.generatedBy || 'System Auditor'}`, margin + 35, y + 12, {
    align: 'center',
  });
  doc.text('Verified By Branch Manager / General Director', pageW - margin - 35, y + 12, {
    align: 'center',
  });

  // Footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Baxnaano Multi-Branch ERP • Africa/Mogadishu (UTC+3) • Official Financial Report`,
      margin,
      pageH - 5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 5, { align: 'right' });
  }

  return doc;
}

export function reportPdfFileName(period: string, branchId: string): string {
  return `Baxnaano-Financial-Report-${branchId}-${period}-${new Date().toISOString().slice(0, 10)}.pdf`;
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

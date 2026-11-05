/**
 * Baxnaano Online-Only System
 * Authoritative Financial Reports, Analytics & Rollover API
 */
import { apiClient } from './client';
import {
  DashboardAnalyticsResponse,
  DashboardAnalyticsResponseSchema,
  ComprehensiveReportResponse,
  ComprehensiveReportResponseSchema,
  FullFinancialReportResponse,
  FullFinancialReportResponseSchema,
  UnifiedFinancialTransaction,
  FinancialSummaryKpis,
  FinancialTrendPoint,
  BranchFinancialSummary,
  SupplierPayableSummary,
  DailyRolloverCloseRecord,
} from '@baxnaano/shared';

export type {
  DashboardAnalyticsResponse,
  ComprehensiveReportResponse,
  FullFinancialReportResponse,
  UnifiedFinancialTransaction,
  FinancialSummaryKpis,
  FinancialTrendPoint,
  BranchFinancialSummary,
  SupplierPayableSummary,
  DailyRolloverCloseRecord,
};

export interface ServerAuditLog {
  id: string;
  branchId?: string | null;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldData?: any;
  newData?: any;
  ipAddress?: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; username: string };
  branch?: { id: string; code: string; name: string };
}

export interface FinancialReportFilterParams {
  preset?: string;
  fromDate?: string;
  toDate?: string;
  branchId?: string;
  transactionType?: string;
  paymentMethod?: string;
  employeeId?: string;
  status?: string;
  search?: string;
}

export const reportsApi = {
  async getDashboard(branchId?: string): Promise<DashboardAnalyticsResponse> {
    const headers = branchId && branchId !== 'ALL' ? { 'x-branch-id': branchId } : undefined;
    const res = await apiClient.get<any>('/reports/dashboard', { headers });
    const kpis = res.kpis || res.kpi || {};
    const alerts = res.alerts || {};
    const formatted: DashboardAnalyticsResponse = {
      kpis: {
        todaySalesUsd: Number(kpis.todaySalesUsd || 0),
        todayRevenueUsd: Number(kpis.todayRevenueUsd ?? kpis.todaySalesUsd ?? 0),
        todayExpensesUsd: Number(kpis.todayExpensesUsd || 0),
        todayGrossProfitUsd: Number(kpis.todayGrossProfitUsd || 0),
        todayNetProfitUsd: Number(kpis.todayNetProfitUsd || 0),
        todayCashUsd: Number(kpis.todayCashUsd || 0),
        todayMobileMoneyUsd: Number(kpis.todayMobileMoneyUsd || 0),
        todayCreditUsd: Number(kpis.todayCreditUsd || 0),
        todayPurchasesUsd: Number(kpis.todayPurchasesUsd || 0),
        todayCustomerPaymentsUsd: Number(kpis.todayCustomerPaymentsUsd || 0),
        todaySupplierPaymentsUsd: Number(kpis.todaySupplierPaymentsUsd || 0),
        todayRefundsUsd: Number(kpis.todayRefundsUsd || 0),
        todayCashFlowUsd: Number(kpis.todayCashFlowUsd || 0),
        cashBalanceUsd: Number(kpis.cashBalanceUsd || 0),
        outstandingReceivablesUsd: Number(kpis.outstandingReceivablesUsd || 0),
        outstandingPayablesUsd: Number(kpis.outstandingPayablesUsd || 0),
        businessDateMogadishu: kpis.businessDateMogadishu || undefined,
      },
      alerts: {
        lowStockCount: Number(alerts.lowStockCount ?? kpis.lowStockCount ?? 0),
        expiredBatchesCount: Number(alerts.expiredBatchesCount ?? kpis.expiredBatchesCount ?? 0),
        expiring30Count: Number(alerts.expiring30Count ?? kpis.expiring30Count ?? 0),
        expiring60Count: Number(alerts.expiring60Count ?? kpis.expiring60Count ?? 0),
        expiring90Count: Number(alerts.expiring90Count ?? kpis.expiring90Count ?? 0),
        todayAppointmentsCount: Number(
          alerts.todayAppointmentsCount ?? kpis.todayAppointmentsCount ?? 0
        ),
        openTasksCount: Number(alerts.openTasksCount ?? kpis.openTasksCount ?? 0),
      },
      trend7Days: res.trend7Days || [],
      trend30Days: res.trend30Days || [],
      topSellingItems: res.topSellingItems || [],
      todayAppointments: res.todayAppointments || [],
      branchComparison: (res.branchComparison || []).map((b: any) => ({
        ...b,
        monthNetProfitUsd: Number(b.monthNetProfitUsd ?? b.monthProfitUsd ?? 0),
      })),
    };

    return DashboardAnalyticsResponseSchema.parse(formatted);
  },

  async getFinancialReport(
    params: FinancialReportFilterParams
  ): Promise<FullFinancialReportResponse> {
    const query = new URLSearchParams();
    if (params.preset) query.set('preset', params.preset);
    if (params.fromDate) query.set('fromDate', params.fromDate);
    if (params.toDate) query.set('toDate', params.toDate);
    if (params.branchId) query.set('branchId', params.branchId);
    if (params.transactionType) query.set('transactionType', params.transactionType);
    if (params.paymentMethod) query.set('paymentMethod', params.paymentMethod);
    if (params.employeeId) query.set('employeeId', params.employeeId);
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);

    const headers =
      params.branchId && params.branchId !== 'ALL'
        ? { 'x-branch-id': params.branchId }
        : undefined;

    const res = await apiClient.get<FullFinancialReportResponse>(
      `/reports/financial?${query.toString()}`,
      { headers }
    );
    return FullFinancialReportResponseSchema.parse(res);
  },

  async getComprehensive(
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'MONTHLY',
    branchId?: string
  ): Promise<ComprehensiveReportResponse> {
    const headers = branchId && branchId !== 'ALL' ? { 'x-branch-id': branchId } : undefined;
    const res = await apiClient.get<ComprehensiveReportResponse>(
      `/reports/comprehensive?period=${period}`,
      { headers }
    );
    return ComprehensiveReportResponseSchema.parse(res);
  },

  async recordSupplierPayment(payload: {
    supplierId: string;
    amountOriginal: number;
    currency?: 'USD' | 'SLSH';
    exchangeRateUsed?: number;
    paymentMethod?: 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
    referenceNumber?: string;
    notes?: string;
    branchId?: string;
  }) {
    const headers =
      payload.branchId && payload.branchId !== 'ALL'
        ? { 'x-branch-id': payload.branchId }
        : undefined;
    return apiClient.post<any>('/reports/supplier-payments', payload, { headers });
  },

  async verifyRollover() {
    return apiClient.post<{
      success: boolean;
      timezone: string;
      currentMogadishuDate: string;
      yesterdayMogadishuDate: string;
      closedDays: string[];
    }>('/reports/rollover/verify', {});
  },

  async getAuditLogs(limit: number = 100): Promise<ServerAuditLog[]> {
    const res = await apiClient.get<{ auditLogs: ServerAuditLog[] }>(
      `/reports/settings/audit-logs?limit=${limit}`
    );
    return res.auditLogs;
  },
};

/**
 * Exports tabular array to an Excel-compatible UTF-8 BOM CSV file (.csv)
 */
export function exportToExcelCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const cell = row[h] === null || row[h] === undefined ? '' : String(row[h]);
          return `"${cell.replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
  ];

  const blob = new Blob(['\uFEFF' + csvLines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Exports a multi-worksheet Microsoft Excel XML Workbook (.xls) containing:
 * 1. Executive Financial Summary & P&L
 * 2. Filtered Financial Transactions Ledger
 * 3. Branch Comparison (B1, B2, B3)
 * 4. Accounts Receivable & Payable
 */
export function exportFinancialReportToExcel(
  filename: string,
  report: FullFinancialReportResponse
) {
  const esc = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const k = report.kpis;
  const f = report.appliedFilters;

  const summaryRows = [
    ['BAXNAANO PHARMACY & VETERINARY CLINIC - FINANCIAL REPORT', ''],
    ['Timezone', `${report.timezone} (UTC+3)`],
    ['Business Date (Africa/Mogadishu)', report.currentMogadishuDate],
    ['Report Period', `${f.preset} (${f.fromDate} to ${f.toDate})`],
    ['Branch Scope', f.branchId],
    ['Transaction Filter', f.transactionType],
    ['Payment Method Filter', f.paymentMethod],
    ['Status Filter', f.status],
    ['', ''],
    ['METRIC', 'AMOUNT (USD)'],
    ['Total Gross Sales', k.totalSalesUsd.toFixed(2)],
    ['Discounts Applied', (-k.discountsUsd).toFixed(2)],
    ['Customer Refunds / Returns', (-k.refundsUsd).toFixed(2)],
    ['Net Sales Revenue', k.totalRevenueUsd.toFixed(2)],
    ['Cost of Goods Sold (COGS)', (-k.cogsUsd).toFixed(2)],
    ['Gross Profit', k.grossProfitUsd.toFixed(2)],
    ['Gross Margin (%)', `${k.grossMarginPct.toFixed(2)}%`],
    ['Approved Operating Expenses', (-k.totalExpensesUsd).toFixed(2)],
    ['Net Profit', k.netProfitUsd.toFixed(2)],
    ['Net Margin (%)', `${k.netMarginPct.toFixed(2)}%`],
    ['', ''],
    ['CASH FLOW & WORKING CAPITAL', 'AMOUNT (USD)'],
    ['POS Cash & Mobile Money Collected', k.posCashCollectedUsd.toFixed(2)],
    ['Customer Credit Repayments Collected', k.customerPaymentsUsd.toFixed(2)],
    ['Total Cash Inflow', k.cashInflowUsd.toFixed(2)],
    ['Supplier Payments Outflow', (-k.supplierPaymentsUsd).toFixed(2)],
    ['Approved Expenses Outflow', (-k.totalExpensesUsd).toFixed(2)],
    ['Total Cash Outflow', (-k.cashOutflowUsd).toFixed(2)],
    ['Net Cash Flow (Period)', k.netCashFlowUsd.toFixed(2)],
    ['Cumulative Cash Balance on Hand', k.cashBalanceUsd.toFixed(2)],
    ['Credit Sales Issued (Period)', k.creditSalesUsd.toFixed(2)],
    ['Total Purchases (Stock-In)', k.totalPurchasesUsd.toFixed(2)],
    ['Outstanding Accounts Receivable (Customers)', k.outstandingReceivablesUsd.toFixed(2)],
    ['Outstanding Accounts Payable (Suppliers)', k.outstandingPayablesUsd.toFixed(2)],
  ];

  const buildSheetXml = (sheetName: string, headers: string[], rows: unknown[][]) => `
    <Worksheet ss:Name="${esc(sheetName)}">
      <Table>
        <Row>
          ${headers
            .map(
              (h) =>
                `<Cell ss:StyleID="Header"><Data ss:Type="String">${esc(h)}</Data></Cell>`
            )
            .join('')}
        </Row>
        ${rows
          .map(
            (r) =>
              `<Row>${r
                .map((cell) => {
                  const num = typeof cell === 'number' ? cell : Number(cell);
                  const isNumeric =
                    typeof cell === 'number' ||
                    (typeof cell === 'string' && /^-?\d+(\.\d+)?$/.test(cell.trim()));
                  return `<Cell><Data ss:Type="${isNumeric ? 'Number' : 'String'}">${esc(
                    isNumeric ? num : cell
                  )}</Data></Cell>`;
                })
                .join('')}</Row>`
          )
          .join('')}
      </Table>
    </Worksheet>`;

  const txHeaders = [
    'Date (Africa/Mogadishu)',
    'Time',
    'Type',
    'Reference #',
    'Branch',
    'Customer / Supplier / Payee',
    'Employee',
    'Payment Method',
    'Status',
    'Gross USD',
    'Discount USD',
    'Net Amount USD',
    'Cash Impact USD',
    'Revenue Impact USD',
    'Profit Impact USD',
    'Description',
  ];

  const txRows = report.transactions.map((tx) => [
    tx.mogadishuDate,
    tx.mogadishuTime,
    tx.type,
    tx.referenceNumber,
    tx.branchCode,
    tx.partyName,
    tx.employeeName,
    tx.paymentMethod,
    tx.status,
    tx.grossAmountUsd.toFixed(2),
    tx.discountUsd.toFixed(2),
    tx.netAmountUsd.toFixed(2),
    tx.cashImpactUsd.toFixed(2),
    tx.revenueImpactUsd.toFixed(2),
    tx.profitImpactUsd.toFixed(2),
    tx.description,
  ]);

  const branchHeaders = [
    'Branch Code',
    'Branch Name',
    'Location',
    'Net Revenue USD',
    'Gross Sales USD',
    'Purchases USD',
    'Expenses USD',
    'Gross Profit USD',
    'Net Profit USD',
    'Cash Inflow USD',
    'Cash Outflow USD',
    'Net Cash Flow USD',
    'Credit Sales USD',
    'Customer Collections USD',
    'Supplier Payments USD',
    'Receivables USD',
    'Payables USD',
  ];

  const branchRows = report.branchSummaries.map((b) => [
    b.code,
    b.name,
    b.location,
    b.revenueUsd.toFixed(2),
    b.salesUsd.toFixed(2),
    b.purchasesUsd.toFixed(2),
    b.expensesUsd.toFixed(2),
    b.grossProfitUsd.toFixed(2),
    b.netProfitUsd.toFixed(2),
    b.cashInflowUsd.toFixed(2),
    b.cashOutflowUsd.toFixed(2),
    b.netCashFlowUsd.toFixed(2),
    b.creditSalesUsd.toFixed(2),
    b.customerPaymentsUsd.toFixed(2),
    b.supplierPaymentsUsd.toFixed(2),
    b.receivablesUsd.toFixed(2),
    b.payablesUsd.toFixed(2),
  ]);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#059669" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${buildSheetXml('Executive Summary', ['Financial Metric', 'Value (USD)'], summaryRows)}
  ${buildSheetXml('Transactions Ledger', txHeaders, txRows)}
  ${buildSheetXml('Branches B1-B3', branchHeaders, branchRows)}
</Workbook>`;

  const blob = new Blob([xml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

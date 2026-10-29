/**
 * Baxnaano Online-Only System
 * Authoritative Reports & Analytics API
 */
import { apiClient } from './client';

export interface DashboardAnalyticsResponse {
  kpis: {
    todaySalesUsd: number;
    todayExpensesUsd: number;
    todayGrossProfitUsd: number;
    todayNetProfitUsd: number;
    todayCashUsd: number;
    todayMobileMoneyUsd: number;
    todayCreditUsd: number;
  };
  alerts: {
    lowStockCount: number;
    expiredBatchesCount: number;
    expiring30Count: number;
    expiring60Count: number;
    expiring90Count: number;
    todayAppointmentsCount: number;
    openTasksCount: number;
  };
  trend7Days: Array<{ date: string; salesUsd: number; profitUsd: number }>;
  trend30Days: Array<{ date: string; salesUsd: number; profitUsd: number }>;
  topSellingItems: Array<{
    productId: string;
    name: string;
    sku: string;
    quantitySold: number;
    revenueUsd: number;
  }>;
  todayAppointments: any[];
  branchComparison: Array<{
    branchId: string;
    code: string;
    name: string;
    type: string;
    location: string;
    todaySalesUsd: number;
    monthSalesUsd: number;
    monthProfitUsd: number;
    monthNetProfitUsd: number;
  }>;
}

export interface ComprehensiveReportResponse {
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  profitAndLoss: {
    revenueUsd: number;
    cogsUsd: number;
    grossProfitUsd: number;
    expensesUsd: number;
    netProfitUsd: number;
  };
  stockValuation: {
    totalCostValuationUsd: number;
    totalRetailValuationUsd: number;
    projectedMarginUsd: number;
  };
  fastMovers: Array<{
    productId: string;
    name: string;
    sku: string;
    quantitySold: number;
    revenueUsd: number;
  }>;
  slowMovers: Array<{
    productId: string;
    name: string;
    sku: string;
    currentStock: number;
    valuationUsd: number;
  }>;
  creditAgingTotals: {
    totalDueUsd: number;
    bucket0to30Usd: number;
    bucket31to60Usd: number;
    bucket60PlusUsd: number;
  };
  appointmentsSummary: {
    total: number;
    done: number;
    booked: number;
    cancelledOrNoShow: number;
  };
  staffPerformance: Array<{
    staffId: string;
    name: string;
    transactionCount: number;
    totalRevenueUsd: number;
  }>;
}

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

export const reportsApi = {
  async getDashboard(branchId?: string): Promise<DashboardAnalyticsResponse> {
    const headers = branchId && branchId !== 'ALL' ? { 'x-branch-id': branchId } : undefined;
    const res = await apiClient.get<any>('/reports/dashboard', { headers });
    const kpi = res.kpi || {};
    return {
      kpis: {
        todaySalesUsd: Number(kpi.todaySalesUsd || 0),
        todayExpensesUsd: Number(kpi.todayExpensesUsd || 0),
        todayGrossProfitUsd: Number(kpi.todayGrossProfitUsd || 0),
        todayNetProfitUsd: Number(kpi.todayNetProfitUsd || 0),
        todayCashUsd: Number(kpi.todayCashUsd || 0),
        todayMobileMoneyUsd: Number(kpi.todayMobileMoneyUsd || 0),
        todayCreditUsd: Number(kpi.todayCreditUsd || 0),
      },
      alerts: {
        lowStockCount: Number(kpi.lowStockCount || 0),
        expiredBatchesCount: Number(kpi.expiredBatchesCount || 0),
        expiring30Count: Number(kpi.expiring30Count || 0),
        expiring60Count: Number(kpi.expiring60Count || 0),
        expiring90Count: Number(kpi.expiring90Count || 0),
        todayAppointmentsCount: Number(kpi.todayAppointmentsCount || 0),
        openTasksCount: Number(kpi.openTasksCount || 0),
      },
      trend7Days: res.trend7Days || [],
      trend30Days: res.trend30Days || [],
      topSellingItems: res.topSellingItems || [],
      todayAppointments: res.todayAppointments || [],
      branchComparison: (res.branchComparison || []).map((b: any) => ({
        ...b,
        monthNetProfitUsd: Number(b.monthProfitUsd ?? b.monthNetProfitUsd ?? 0),
      })),
    };
  },

  async getComprehensive(
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'MONTHLY',
    branchId?: string
  ): Promise<ComprehensiveReportResponse> {
    const headers = branchId ? { 'x-branch-id': branchId } : undefined;
    return apiClient.get<ComprehensiveReportResponse>(`/reports/comprehensive?period=${period}`, {
      headers,
    });
  },

  async getAuditLogs(limit: number = 100): Promise<ServerAuditLog[]> {
    const res = await apiClient.get<{ auditLogs: ServerAuditLog[] }>(
      `/reports/settings/audit-logs?limit=${limit}`
    );
    return res.auditLogs;
  },
};

/**
 * Exports tabular array to an Excel-compatible UTF-8 BOM CSV file
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
}

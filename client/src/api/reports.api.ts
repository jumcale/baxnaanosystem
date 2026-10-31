/**
 * Baxnaano Online-Only System
 * Authoritative Reports & Analytics API
 */
import { apiClient } from './client';
import {
  DashboardAnalyticsResponse,
  DashboardAnalyticsResponseSchema,
  ComprehensiveReportResponse,
  ComprehensiveReportResponseSchema,
} from '@baxnaano/shared';

export type { DashboardAnalyticsResponse, ComprehensiveReportResponse };

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
    const kpis = res.kpis || res.kpi || {};
    const alerts = res.alerts || {};
    const formatted: DashboardAnalyticsResponse = {
      kpis: {
        todaySalesUsd: Number(kpis.todaySalesUsd || 0),
        todayExpensesUsd: Number(kpis.todayExpensesUsd || 0),
        todayGrossProfitUsd: Number(kpis.todayGrossProfitUsd || 0),
        todayNetProfitUsd: Number(kpis.todayNetProfitUsd || 0),
        todayCashUsd: Number(kpis.todayCashUsd || 0),
        todayMobileMoneyUsd: Number(kpis.todayMobileMoneyUsd || 0),
        todayCreditUsd: Number(kpis.todayCreditUsd || 0),
      },
      alerts: {
        lowStockCount: Number(alerts.lowStockCount ?? kpis.lowStockCount ?? 0),
        expiredBatchesCount: Number(alerts.expiredBatchesCount ?? kpis.expiredBatchesCount ?? 0),
        expiring30Count: Number(alerts.expiring30Count ?? kpis.expiring30Count ?? 0),
        expiring60Count: Number(alerts.expiring60Count ?? kpis.expiring60Count ?? 0),
        expiring90Count: Number(alerts.expiring90Count ?? kpis.expiring90Count ?? 0),
        todayAppointmentsCount: Number(alerts.todayAppointmentsCount ?? kpis.todayAppointmentsCount ?? 0),
        openTasksCount: Number(alerts.openTasksCount ?? kpis.openTasksCount ?? 0),
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

    return DashboardAnalyticsResponseSchema.parse(formatted);
  },

  async getComprehensive(
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'MONTHLY',
    branchId?: string
  ): Promise<ComprehensiveReportResponse> {
    const headers = branchId ? { 'x-branch-id': branchId } : undefined;
    const res = await apiClient.get<ComprehensiveReportResponse>(`/reports/comprehensive?period=${period}`, {
      headers,
    });
    return ComprehensiveReportResponseSchema.parse(res);
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

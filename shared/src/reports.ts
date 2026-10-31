import { z } from 'zod';

export const DashboardKpisSchema = z.object({
  todaySalesUsd: z.number(),
  todayExpensesUsd: z.number(),
  todayGrossProfitUsd: z.number(),
  todayNetProfitUsd: z.number(),
  todayCashUsd: z.number(),
  todayMobileMoneyUsd: z.number(),
  todayCreditUsd: z.number(),
});

export const DashboardAlertsSchema = z.object({
  lowStockCount: z.number(),
  expiredBatchesCount: z.number(),
  expiring30Count: z.number(),
  expiring60Count: z.number(),
  expiring90Count: z.number(),
  todayAppointmentsCount: z.number(),
  openTasksCount: z.number(),
});

export const DashboardTrendPointSchema = z.object({
  date: z.string(),
  salesUsd: z.number(),
  profitUsd: z.number(),
});

export const DashboardTopSellingItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  quantitySold: z.number(),
  revenueUsd: z.number(),
});

export const DashboardBranchComparisonItemSchema = z.object({
  branchId: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  location: z.string(),
  todaySalesUsd: z.number(),
  monthSalesUsd: z.number(),
  monthProfitUsd: z.number(),
  monthNetProfitUsd: z.number(),
});

export const DashboardAnalyticsResponseSchema = z.object({
  kpis: DashboardKpisSchema,
  alerts: DashboardAlertsSchema,
  trend7Days: z.array(DashboardTrendPointSchema),
  trend30Days: z.array(DashboardTrendPointSchema),
  topSellingItems: z.array(DashboardTopSellingItemSchema),
  todayAppointments: z.array(z.any()),
  branchComparison: z.array(DashboardBranchComparisonItemSchema),
});

export type DashboardAnalyticsResponse = z.infer<typeof DashboardAnalyticsResponseSchema>;

export const ComprehensiveReportResponseSchema = z.object({
  period: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  profitAndLoss: z.object({
    revenueUsd: z.number(),
    cogsUsd: z.number(),
    grossProfitUsd: z.number(),
    expensesUsd: z.number(),
    netProfitUsd: z.number(),
  }),
  stockValuation: z.object({
    totalCostValuationUsd: z.number(),
    totalRetailValuationUsd: z.number(),
    projectedMarginUsd: z.number(),
  }),
  fastMovers: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      sku: z.string(),
      quantitySold: z.number(),
      revenueUsd: z.number(),
    })
  ),
  slowMovers: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      sku: z.string(),
      currentStock: z.number(),
      valuationUsd: z.number(),
    })
  ),
  creditAgingTotals: z.object({
    totalDueUsd: z.number(),
    bucket0to30Usd: z.number(),
    bucket31to60Usd: z.number(),
    bucket60PlusUsd: z.number(),
  }),
  appointmentsSummary: z.object({
    total: z.number(),
    done: z.number(),
    booked: z.number(),
    cancelledOrNoShow: z.number(),
  }),
  staffPerformance: z.array(
    z.object({
      staffId: z.string(),
      name: z.string(),
      transactionCount: z.number(),
      totalRevenueUsd: z.number(),
    })
  ),
});

export type ComprehensiveReportResponse = z.infer<typeof ComprehensiveReportResponseSchema>;

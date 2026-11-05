import { z } from 'zod';

export const DashboardKpisSchema = z.object({
  todaySalesUsd: z.coerce.number(),
  todayExpensesUsd: z.coerce.number(),
  todayGrossProfitUsd: z.coerce.number(),
  todayNetProfitUsd: z.coerce.number(),
  todayCashUsd: z.coerce.number(),
  todayMobileMoneyUsd: z.coerce.number(),
  todayCreditUsd: z.coerce.number(),
  todayRevenueUsd: z.coerce.number().optional(),
  todayPurchasesUsd: z.coerce.number().optional(),
  todayCustomerPaymentsUsd: z.coerce.number().optional(),
  todaySupplierPaymentsUsd: z.coerce.number().optional(),
  todayRefundsUsd: z.coerce.number().optional(),
  todayCashFlowUsd: z.coerce.number().optional(),
  cashBalanceUsd: z.coerce.number().optional(),
  outstandingReceivablesUsd: z.coerce.number().optional(),
  outstandingPayablesUsd: z.coerce.number().optional(),
  businessDateMogadishu: z.string().optional(),
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
  todaySalesUsd: z.coerce.number(),
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

export const REPORT_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'CUSTOM',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
] as const;

export type ReportDatePreset = (typeof REPORT_DATE_PRESETS)[number];

export const FINANCIAL_TRANSACTION_TYPES = [
  'ALL',
  'SALE',
  'CREDIT_SALE',
  'REFUND',
  'CUSTOMER_PAYMENT',
  'PURCHASE',
  'SUPPLIER_PAYMENT',
  'EXPENSE',
  'INVENTORY_ADJUSTMENT',
  'BRANCH_TRANSFER',
] as const;

export type FinancialTransactionType = (typeof FINANCIAL_TRANSACTION_TYPES)[number];

export const FinancialSummaryKpisSchema = z.object({
  totalRevenueUsd: z.coerce.number(),
  totalSalesUsd: z.coerce.number(),
  salesCount: z.coerce.number(),
  discountsUsd: z.coerce.number(),
  refundsUsd: z.coerce.number(),
  voidedSalesUsd: z.coerce.number(),
  voidedCount: z.coerce.number(),
  cogsUsd: z.coerce.number(),
  grossProfitUsd: z.coerce.number(),
  grossMarginPct: z.coerce.number(),
  totalPurchasesUsd: z.coerce.number(),
  purchasesCount: z.coerce.number(),
  totalExpensesUsd: z.coerce.number(),
  pendingExpensesUsd: z.coerce.number(),
  inventoryShrinkageUsd: z.coerce.number(),
  netProfitUsd: z.coerce.number(),
  netMarginPct: z.coerce.number(),
  creditSalesUsd: z.coerce.number(),
  posCashCollectedUsd: z.coerce.number(),
  customerPaymentsUsd: z.coerce.number(),
  supplierPaymentsUsd: z.coerce.number(),
  cashInflowUsd: z.coerce.number(),
  cashOutflowUsd: z.coerce.number(),
  netCashFlowUsd: z.coerce.number(),
  cashBalanceUsd: z.coerce.number(),
  cashByMethod: z.object({
    CASH: z.coerce.number(),
    EVC_PLUS: z.coerce.number(),
    ZAAD: z.coerce.number(),
    EDAHAB: z.coerce.number(),
  }),
  outstandingReceivablesUsd: z.coerce.number(),
  outstandingPayablesUsd: z.coerce.number(),
});

export type FinancialSummaryKpis = z.infer<typeof FinancialSummaryKpisSchema>;

export const UnifiedFinancialTransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  mogadishuDate: z.string(),
  mogadishuTime: z.string(),
  type: z.enum([
    'SALE',
    'CREDIT_SALE',
    'REFUND',
    'CUSTOMER_PAYMENT',
    'PURCHASE',
    'SUPPLIER_PAYMENT',
    'EXPENSE',
    'INVENTORY_ADJUSTMENT',
    'BRANCH_TRANSFER',
  ]),
  referenceNumber: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  branchName: z.string(),
  partyName: z.string(),
  employeeId: z.string().nullable().optional(),
  employeeName: z.string(),
  paymentMethod: z.string(),
  status: z.string(),
  grossAmountUsd: z.coerce.number(),
  discountUsd: z.coerce.number(),
  netAmountUsd: z.coerce.number(),
  cashImpactUsd: z.coerce.number(),
  revenueImpactUsd: z.coerce.number(),
  profitImpactUsd: z.coerce.number(),
  description: z.string(),
  sourceModule: z.string(),
  isExcludedFromTotals: z.boolean().default(false),
});

export type UnifiedFinancialTransaction = z.infer<typeof UnifiedFinancialTransactionSchema>;

export const FinancialTrendPointSchema = z.object({
  date: z.string(),
  label: z.string(),
  salesUsd: z.coerce.number(),
  revenueUsd: z.coerce.number(),
  purchasesUsd: z.coerce.number(),
  expensesUsd: z.coerce.number(),
  grossProfitUsd: z.coerce.number(),
  netProfitUsd: z.coerce.number(),
  cashInflowUsd: z.coerce.number(),
  cashOutflowUsd: z.coerce.number(),
  netCashFlowUsd: z.coerce.number(),
  creditSalesUsd: z.coerce.number(),
  customerPaymentsUsd: z.coerce.number(),
});

export type FinancialTrendPoint = z.infer<typeof FinancialTrendPointSchema>;

export const BranchFinancialSummarySchema = z.object({
  branchId: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string(),
  location: z.string(),
  revenueUsd: z.coerce.number(),
  salesUsd: z.coerce.number(),
  purchasesUsd: z.coerce.number(),
  expensesUsd: z.coerce.number(),
  grossProfitUsd: z.coerce.number(),
  netProfitUsd: z.coerce.number(),
  cashInflowUsd: z.coerce.number(),
  cashOutflowUsd: z.coerce.number(),
  netCashFlowUsd: z.coerce.number(),
  creditSalesUsd: z.coerce.number(),
  customerPaymentsUsd: z.coerce.number(),
  supplierPaymentsUsd: z.coerce.number(),
  receivablesUsd: z.coerce.number(),
  payablesUsd: z.coerce.number(),
  inventoryCostValUsd: z.coerce.number(),
  inventoryRetailValUsd: z.coerce.number(),
});

export type BranchFinancialSummary = z.infer<typeof BranchFinancialSummarySchema>;

export const SupplierPayableSummarySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  name: z.string(),
  contactPerson: z.string().nullable().optional(),
  phone: z.string(),
  balanceUsd: z.coerce.number(),
  totalPurchasedUsd: z.coerce.number(),
  totalPaidUsd: z.coerce.number(),
  purchasesCount: z.coerce.number(),
});

export type SupplierPayableSummary = z.infer<typeof SupplierPayableSummarySchema>;

export const DailyRolloverCloseRecordSchema = z.object({
  id: z.string(),
  businessDate: z.string(),
  branchId: z.string().nullable().optional(),
  branchCode: z.string(),
  closedAt: z.string(),
  closedBy: z.string(),
  totalSalesUsd: z.coerce.number(),
  totalRevenueUsd: z.coerce.number(),
  totalPurchasesUsd: z.coerce.number(),
  totalExpensesUsd: z.coerce.number(),
  grossProfitUsd: z.coerce.number(),
  netProfitUsd: z.coerce.number(),
  cashInflowUsd: z.coerce.number(),
  cashOutflowUsd: z.coerce.number(),
  netCashFlowUsd: z.coerce.number(),
  creditSalesUsd: z.coerce.number(),
  customerPaymentsUsd: z.coerce.number(),
  supplierPaymentsUsd: z.coerce.number(),
  transactionCount: z.coerce.number(),
});

export type DailyRolloverCloseRecord = z.infer<typeof DailyRolloverCloseRecordSchema>;

export const ComprehensiveReportResponseSchema = z.object({
  period: z.string(),
  profitAndLoss: z.object({
    revenueUsd: z.coerce.number(),
    cogsUsd: z.coerce.number(),
    grossProfitUsd: z.coerce.number(),
    expensesUsd: z.coerce.number(),
    netProfitUsd: z.coerce.number(),
  }),
  stockValuation: z.object({
    totalCostValuationUsd: z.coerce.number(),
    totalRetailValuationUsd: z.coerce.number(),
    projectedMarginUsd: z.coerce.number(),
  }),
  fastMovers: z.array(z.any()),
  slowMovers: z.array(z.any()),
  creditAgingTotals: z.object({
    totalDueUsd: z.coerce.number(),
    bucket0to30Usd: z.coerce.number(),
    bucket31to60Usd: z.coerce.number(),
    bucket60PlusUsd: z.coerce.number(),
  }),
  appointmentsSummary: z.object({
    total: z.coerce.number(),
    done: z.coerce.number(),
    booked: z.coerce.number(),
    cancelledOrNoShow: z.coerce.number(),
  }),
  staffPerformance: z.array(z.any()),
});

export type ComprehensiveReportResponse = z.infer<typeof ComprehensiveReportResponseSchema>;

export const FullFinancialReportResponseSchema = z.object({
  timezone: z.string(),
  currentMogadishuDate: z.string(),
  currentMogadishuTime: z.string(),
  nextRolloverAtIso: z.string(),
  appliedFilters: z.object({
    preset: z.string(),
    fromDate: z.string(),
    toDate: z.string(),
    branchId: z.string(),
    transactionType: z.string(),
    paymentMethod: z.string(),
    employeeId: z.string(),
    status: z.string(),
    search: z.string(),
  }),
  kpis: FinancialSummaryKpisSchema,
  comparisonWithPreviousPeriod: z.object({
    previousLabel: z.string(),
    previousRevenueUsd: z.coerce.number(),
    revenueChangePct: z.coerce.number(),
    previousNetProfitUsd: z.coerce.number(),
    netProfitChangePct: z.coerce.number(),
    previousExpensesUsd: z.coerce.number(),
    expensesChangePct: z.coerce.number(),
    previousCashFlowUsd: z.coerce.number(),
  }),
  dailyTrends: z.array(FinancialTrendPointSchema),
  weeklyTrends: z.array(FinancialTrendPointSchema),
  monthlyTrends: z.array(FinancialTrendPointSchema),
  branchSummaries: z.array(BranchFinancialSummarySchema),
  transactions: z.array(UnifiedFinancialTransactionSchema),
  creditAgingTotals: z.object({
    totalDueUsd: z.coerce.number(),
    bucket0to30Usd: z.coerce.number(),
    bucket31to60Usd: z.coerce.number(),
    bucket60PlusUsd: z.coerce.number(),
  }),
  receivablesCustomers: z.array(z.any()),
  payablesSuppliers: z.array(SupplierPayableSummarySchema),
  stockValuation: z.object({
    totalCostValuationUsd: z.coerce.number(),
    totalRetailValuationUsd: z.coerce.number(),
    projectedMarginUsd: z.coerce.number(),
    totalSellableUnits: z.coerce.number(),
    totalExpiredUnits: z.coerce.number(),
    expiredValuationUsd: z.coerce.number(),
  }),
  fastMovers: z.array(z.any()),
  slowMovers: z.array(z.any()),
  staffPerformance: z.array(
    z.object({
      employeeId: z.string(),
      fullName: z.string(),
      username: z.string(),
      role: z.string(),
      branchCode: z.string(),
      salesCount: z.coerce.number(),
      totalSalesUsd: z.coerce.number(),
      netRevenueUsd: z.coerce.number(),
      cashCollectedUsd: z.coerce.number(),
      creditSalesUsd: z.coerce.number(),
      expensesRecordedUsd: z.coerce.number(),
    })
  ),
  employeesFilterOptions: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      username: z.string(),
      role: z.string(),
      branchCode: z.string().nullable(),
    })
  ),
  rolloverHistory: z.array(DailyRolloverCloseRecordSchema),
});

export type FullFinancialReportResponse = z.infer<typeof FullFinancialReportResponseSchema>;

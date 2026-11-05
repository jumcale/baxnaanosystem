import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import {
  classifyExpiryBucket,
  computeCustomerCreditAging,
  FullFinancialReportResponse,
  UnifiedFinancialTransaction,
  FinancialSummaryKpis,
  FinancialTrendPoint,
  BranchFinancialSummary,
  SupplierPayableSummary,
  DailyRolloverCloseRecord,
} from '@baxnaano/shared';

const Decimal = Prisma.Decimal;
type DecimalVal = Prisma.Decimal;

export const MOGADISHU_TIMEZONE = 'Africa/Mogadishu';
export const MOGADISHU_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 year-round

export function d(val: DecimalVal | number | string | null | undefined): DecimalVal {
  if (val === null || val === undefined || val === '') return new Decimal(0);
  try {
    return new Decimal(val);
  } catch {
    return new Decimal(0);
  }
}

export function round2(val: DecimalVal): number {
  return Number(val.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
}

/**
 * Returns YYYY-MM-DD in Africa/Mogadishu (UTC+3)
 */
export function toMogadishuDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + MOGADISHU_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Returns HH:mm:ss in Africa/Mogadishu (UTC+3)
 */
export function toMogadishuTimeString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + MOGADISHU_OFFSET_MS);
  return shifted.toISOString().slice(11, 19);
}

/**
 * Exact UTC start of a business day in Africa/Mogadishu (00:00:00.000+03:00)
 */
export function mogadishuDayStartUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000+03:00`);
}

/**
 * Exact UTC end of a business day in Africa/Mogadishu (23:59:59.999+03:00)
 */
export function mogadishuDayEndUtc(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+03:00`);
}

/**
 * Adds or subtracts calendar days from a YYYY-MM-DD date string
 */
export function addDaysToDateString(dateStr: string, deltaDays: number): string {
  const base = new Date(`${dateStr}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/**
 * Next 12:00 AM midnight in Africa/Mogadishu (UTC+3)
 */
export function getNextMogadishuMidnightUtc(now: Date = new Date()): Date {
  const todayStr = toMogadishuDateString(now);
  const tomorrowStr = addDaysToDateString(todayStr, 1);
  return mogadishuDayStartUtc(tomorrowStr);
}

export interface ResolvedDateWindow {
  preset: string;
  fromDateStr: string;
  toDateStr: string;
  startUtc: Date;
  endUtc: Date;
  prevFromDateStr: string;
  prevToDateStr: string;
  prevStartUtc: Date;
  prevEndUtc: Date;
  prevLabel: string;
}

/**
 * Resolves Today, Yesterday, This Week, Last Week, This Month, Last Month, or Custom Date Range
 * strictly in Africa/Mogadishu (UTC+3).
 */
export function resolveMogadishuDateWindow(
  rawPreset?: string,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date()
): ResolvedDateWindow {
  const todayStr = toMogadishuDateString(now);
  const presetUpper = (rawPreset || 'TODAY').toUpperCase();

  let preset = presetUpper;
  if (presetUpper === 'DAILY') preset = 'TODAY';
  else if (presetUpper === 'WEEKLY') preset = 'THIS_WEEK';
  else if (presetUpper === 'MONTHLY') preset = 'THIS_MONTH';

  let fromDateStr = todayStr;
  let toDateStr = todayStr;
  let prevFromDateStr = addDaysToDateString(todayStr, -1);
  let prevToDateStr = prevFromDateStr;
  let prevLabel = 'vs Yesterday';

  if (preset === 'TODAY') {
    fromDateStr = todayStr;
    toDateStr = todayStr;
    prevFromDateStr = addDaysToDateString(todayStr, -1);
    prevToDateStr = prevFromDateStr;
    prevLabel = 'vs Yesterday';
  } else if (preset === 'YESTERDAY') {
    const yest = addDaysToDateString(todayStr, -1);
    fromDateStr = yest;
    toDateStr = yest;
    prevFromDateStr = addDaysToDateString(todayStr, -2);
    prevToDateStr = prevFromDateStr;
    prevLabel = 'vs Day Before Yesterday';
  } else if (preset === 'THIS_WEEK') {
    // Monday-based week in Africa/Mogadishu
    const refNoon = new Date(`${todayStr}T12:00:00.000Z`);
    const dayOfWeek = refNoon.getUTCDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    fromDateStr = addDaysToDateString(todayStr, -daysSinceMonday);
    toDateStr = todayStr;
    prevFromDateStr = addDaysToDateString(fromDateStr, -7);
    prevToDateStr = addDaysToDateString(fromDateStr, -1);
    prevLabel = 'vs Last Week';
  } else if (preset === 'LAST_WEEK') {
    const refNoon = new Date(`${todayStr}T12:00:00.000Z`);
    const dayOfWeek = refNoon.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const thisMonday = addDaysToDateString(todayStr, -daysSinceMonday);
    fromDateStr = addDaysToDateString(thisMonday, -7);
    toDateStr = addDaysToDateString(thisMonday, -1);
    prevFromDateStr = addDaysToDateString(fromDateStr, -7);
    prevToDateStr = addDaysToDateString(fromDateStr, -1);
    prevLabel = 'vs Prior Week';
  } else if (preset === 'THIS_MONTH') {
    fromDateStr = `${todayStr.slice(0, 7)}-01`;
    toDateStr = todayStr;
    const [yr, mo] = todayStr.slice(0, 7).split('-').map(Number);
    const prevMonthDate = new Date(Date.UTC(yr, mo - 2, 1));
    const prevMonthLastDay = new Date(Date.UTC(yr, mo - 1, 0));
    prevFromDateStr = prevMonthDate.toISOString().slice(0, 10);
    prevToDateStr = prevMonthLastDay.toISOString().slice(0, 10);
    prevLabel = 'vs Last Month';
  } else if (preset === 'LAST_MONTH') {
    const [yr, mo] = todayStr.slice(0, 7).split('-').map(Number);
    const lastMonthStart = new Date(Date.UTC(yr, mo - 2, 1));
    const lastMonthEnd = new Date(Date.UTC(yr, mo - 1, 0));
    fromDateStr = lastMonthStart.toISOString().slice(0, 10);
    toDateStr = lastMonthEnd.toISOString().slice(0, 10);
    const twoMonthsAgoStart = new Date(Date.UTC(yr, mo - 3, 1));
    const twoMonthsAgoEnd = new Date(Date.UTC(yr, mo - 2, 0));
    prevFromDateStr = twoMonthsAgoStart.toISOString().slice(0, 10);
    prevToDateStr = twoMonthsAgoEnd.toISOString().slice(0, 10);
    prevLabel = 'vs Prior Month';
  } else if (preset === 'CUSTOM' || customFrom || customTo) {
    preset = 'CUSTOM';
    fromDateStr =
      customFrom && /^\d{4}-\d{2}-\d{2}$/.test(customFrom)
        ? customFrom
        : customFrom
        ? toMogadishuDateString(new Date(customFrom))
        : todayStr;
    toDateStr =
      customTo && /^\d{4}-\d{2}-\d{2}$/.test(customTo)
        ? customTo
        : customTo
        ? toMogadishuDateString(new Date(customTo))
        : todayStr;
    if (fromDateStr > toDateStr) {
      const tmp = fromDateStr;
      fromDateStr = toDateStr;
      toDateStr = tmp;
    }
    const spanDays =
      Math.max(
        1,
        Math.round(
          (new Date(`${toDateStr}T12:00:00Z`).getTime() -
            new Date(`${fromDateStr}T12:00:00Z`).getTime()) /
            (24 * 60 * 60 * 1000)
        ) + 1
      );
    prevToDateStr = addDaysToDateString(fromDateStr, -1);
    prevFromDateStr = addDaysToDateString(prevToDateStr, -(spanDays - 1));
    prevLabel = `vs Prior ${spanDays} Day(s)`;
  }

  return {
    preset,
    fromDateStr,
    toDateStr,
    startUtc: mogadishuDayStartUtc(fromDateStr),
    endUtc: mogadishuDayEndUtc(toDateStr),
    prevFromDateStr,
    prevToDateStr,
    prevStartUtc: mogadishuDayStartUtc(prevFromDateStr),
    prevEndUtc: mogadishuDayEndUtc(prevToDateStr),
    prevLabel,
  };
}

export interface FinancialReportQueryFilters {
  preset?: string;
  fromDate?: string;
  toDate?: string;
  branchId?: string; // Concrete branch ID or 'ALL' / undefined
  transactionType?: string; // 'ALL' | 'SALE' | 'CREDIT_SALE' | 'REFUND' | 'CUSTOMER_PAYMENT' | 'PURCHASE' | 'SUPPLIER_PAYMENT' | 'EXPENSE' | 'INVENTORY_ADJUSTMENT' | 'BRANCH_TRANSFER'
  paymentMethod?: string; // 'ALL' | 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB' | 'CREDIT'
  employeeId?: string; // 'ALL' or userId
  status?: string; // 'ALL' | 'COMPLETED' | 'APPROVED' | 'PENDING' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'VOIDED' | 'REJECTED'
  search?: string;
}

/**
 * Computes net sale metrics for a single Sale record using Decimal arithmetic.
 * Respects:
 * - Voided sales excluded from financial totals
 * - Refunded items deducted from net revenue, COGS, and POS cash collected
 * - Credit sales never counted as cash received
 */
export function computeSingleSaleFinancials(sale: {
  status: string;
  subtotalUsd: DecimalVal | number;
  discountUsd: DecimalVal | number;
  taxUsd: DecimalVal | number;
  totalUsd: DecimalVal | number;
  paidUsd: DecimalVal | number;
  creditAmountUsd: DecimalVal | number;
  changeUsd: DecimalVal | number;
  items: Array<{
    quantity: number;
    refundedQuantity: number;
    unitBuyPriceUsd: DecimalVal | number;
    unitPriceUsd: DecimalVal | number;
    discountUsd: DecimalVal | number;
    subtotalUsd: DecimalVal | number;
  }>;
  payments: Array<{
    method: string;
    amountUsd: DecimalVal | number;
  }>;
}) {
  if (sale.status === 'VOIDED') {
    return {
      isVoided: true,
      grossSalesUsd: d(0),
      discountUsd: d(0),
      refundsUsd: d(0),
      netRevenueUsd: d(0),
      cogsUsd: d(0),
      grossProfitUsd: d(0),
      creditSalesUsd: d(0),
      posCashCollectedUsd: d(0),
      voidedAmountUsd: d(sale.totalUsd),
      methodCashBreakdown: {
        CASH: d(0),
        EVC_PLUS: d(0),
        ZAAD: d(0),
        EDAHAB: d(0),
      },
    };
  }

  let totalOriginalQty = 0;
  let totalRefundedQty = 0;
  let grossItemsUsd = d(0);
  let refundedItemsGrossUsd = d(0);
  let netCogsUsd = d(0);

  for (const item of sale.items) {
    const qty = Math.max(0, Number(item.quantity || 0));
    const refQty = Math.min(qty, Math.max(0, Number(item.refundedQuantity || 0)));
    const netQty = qty - refQty;

    totalOriginalQty += qty;
    totalRefundedQty += refQty;

    const unitSell = d(item.unitPriceUsd);
    const unitBuy = d(item.unitBuyPriceUsd);
    const itemLineTotal = d(item.subtotalUsd);
    const effectiveUnitNet = qty > 0 ? itemLineTotal.div(qty) : unitSell;

    grossItemsUsd = grossItemsUsd.plus(unitSell.mul(qty));
    refundedItemsGrossUsd = refundedItemsGrossUsd.plus(effectiveUnitNet.mul(refQty));
    netCogsUsd = netCogsUsd.plus(unitBuy.mul(netQty));
  }

  const saleTotalAfterDiscount = d(sale.totalUsd);
  const saleDiscount = d(sale.discountUsd);

  // If items were refunded, compute exact refund value proportionally against the sale total
  let refundsUsd = refundedItemsGrossUsd;
  if (totalOriginalQty > 0 && totalRefundedQty >= totalOriginalQty) {
    refundsUsd = saleTotalAfterDiscount;
  } else if (refundsUsd.gt(saleTotalAfterDiscount)) {
    refundsUsd = saleTotalAfterDiscount;
  }

  const netRevenueUsd = Decimal.max(d(0), saleTotalAfterDiscount.minus(refundsUsd));
  const grossProfitUsd = netRevenueUsd.minus(netCogsUsd);

  // Credit portion vs Cash/Mobile Money portion
  // Credit sales are NEVER counted as cash received
  const creditSalesUsd = Decimal.max(
    d(0),
    d(sale.creditAmountUsd).minus(
      d(sale.creditAmountUsd).gt(netRevenueUsd)
        ? d(sale.creditAmountUsd).minus(netRevenueUsd)
        : d(0)
    )
  );

  const methodCashBreakdown: Record<'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB', DecimalVal> = {
    CASH: d(0),
    EVC_PLUS: d(0),
    ZAAD: d(0),
    EDAHAB: d(0),
  };

  let rawNonCreditPaid = d(0);
  for (const p of sale.payments || []) {
    if (p.method === 'CREDIT') continue;
    const amt = d(p.amountUsd);
    rawNonCreditPaid = rawNonCreditPaid.plus(amt);
    if (p.method === 'CASH') methodCashBreakdown.CASH = methodCashBreakdown.CASH.plus(amt);
    else if (p.method === 'EVC_PLUS')
      methodCashBreakdown.EVC_PLUS = methodCashBreakdown.EVC_PLUS.plus(amt);
    else if (p.method === 'ZAAD') methodCashBreakdown.ZAAD = methodCashBreakdown.ZAAD.plus(amt);
    else if (p.method === 'EDAHAB')
      methodCashBreakdown.EDAHAB = methodCashBreakdown.EDAHAB.plus(amt);
  }

  // Deduct change given in CASH and any cash refunded
  const changeUsd = d(sale.changeUsd);
  if (changeUsd.gt(0)) {
    methodCashBreakdown.CASH = Decimal.max(d(0), methodCashBreakdown.CASH.minus(changeUsd));
  }

  const posCashBeforeRefund = Decimal.max(d(0), rawNonCreditPaid.minus(changeUsd));
  // Cash refunded reduces POS cash collected
  const cashRefunded = Decimal.min(posCashBeforeRefund, refundsUsd);
  const posCashCollectedUsd = Decimal.max(d(0), posCashBeforeRefund.minus(cashRefunded));

  if (cashRefunded.gt(0) && posCashBeforeRefund.gt(0)) {
    const ratio = posCashCollectedUsd.div(posCashBeforeRefund);
    methodCashBreakdown.CASH = methodCashBreakdown.CASH.mul(ratio);
    methodCashBreakdown.EVC_PLUS = methodCashBreakdown.EVC_PLUS.mul(ratio);
    methodCashBreakdown.ZAAD = methodCashBreakdown.ZAAD.mul(ratio);
    methodCashBreakdown.EDAHAB = methodCashBreakdown.EDAHAB.mul(ratio);
  }

  return {
    isVoided: false,
    grossSalesUsd: saleTotalAfterDiscount,
    discountUsd: saleDiscount,
    refundsUsd,
    netRevenueUsd,
    cogsUsd: netCogsUsd,
    grossProfitUsd,
    creditSalesUsd,
    posCashCollectedUsd,
    voidedAmountUsd: d(0),
    methodCashBreakdown,
  };
}

/**
 * Quick period KPI aggregator used for previous-period comparisons and daily rollover snapshots.
 */
export async function computePeriodSummaryKpis(
  startUtc: Date,
  endUtc: Date,
  branchId?: string | null
): Promise<FinancialSummaryKpis> {
  const branchFilter = branchId && branchId !== 'ALL' ? { branchId } : {};

  const [
    sales,
    purchases,
    expenses,
    creditRepayments,
    supplierPaymentLogs,
    stockAdjustments,
    customers,
    suppliers,
    allTimeSales,
    allTimeRepayments,
    allTimePurchases,
    allTimeExpenses,
    allTimeSupplierPaymentLogs,
  ] = await Promise.all([
    prisma.sale.findMany({
      where: {
        ...branchFilter,
        deletedAt: null,
        soldAt: { gte: startUtc, lte: endUtc },
      },
      include: { items: true, payments: true },
    }),
    prisma.purchase.findMany({
      where: {
        ...branchFilter,
        deletedAt: null,
        purchaseDate: { gte: startUtc, lte: endUtc },
      },
    }),
    prisma.expense.findMany({
      where: {
        ...branchFilter,
        deletedAt: null,
        expenseDate: { gte: startUtc, lte: endUtc },
      },
    }),
    prisma.creditLedger.findMany({
      where: {
        ...branchFilter,
        deletedAt: null,
        type: 'PAYMENT',
        createdAt: { gte: startUtc, lte: endUtc },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        ...(branchId && branchId !== 'ALL' ? { branchId } : {}),
        action: 'SUPPLIER_PAYMENT',
        createdAt: { gte: startUtc, lte: endUtc },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        ...branchFilter,
        deletedAt: null,
        type: { in: ['DAMAGE_EXPIRED', 'ADJUSTMENT_MINUS', 'STOCK_TAKE_VARIANCE'] },
        createdAt: { gte: startUtc, lte: endUtc },
      },
    }),
    prisma.customer.findMany({
      where: { ...branchFilter, deletedAt: null },
      select: { currentBalanceUsd: true },
    }),
    prisma.supplier.findMany({
      where: { ...branchFilter, deletedAt: null },
      select: { balanceUsd: true },
    }),
    prisma.sale.findMany({
      where: { ...branchFilter, deletedAt: null, status: { not: 'VOIDED' } },
      select: {
        status: true,
        subtotalUsd: true,
        discountUsd: true,
        taxUsd: true,
        totalUsd: true,
        paidUsd: true,
        creditAmountUsd: true,
        changeUsd: true,
        items: {
          select: {
            quantity: true,
            refundedQuantity: true,
            unitBuyPriceUsd: true,
            unitPriceUsd: true,
            discountUsd: true,
            subtotalUsd: true,
          },
        },
        payments: { select: { method: true, amountUsd: true } },
      },
    }),
    prisma.creditLedger.findMany({
      where: { ...branchFilter, deletedAt: null, type: 'PAYMENT' },
      select: { amountDeltaUsd: true, paymentMethod: true },
    }),
    prisma.purchase.findMany({
      where: { ...branchFilter, deletedAt: null },
      select: { paidAmountUsd: true },
    }),
    prisma.expense.findMany({
      where: { ...branchFilter, deletedAt: null, approvalStatus: 'APPROVED' },
      select: { amountUsd: true, paymentMethod: true },
    }),
    prisma.auditLog.findMany({
      where: {
        ...(branchId && branchId !== 'ALL' ? { branchId } : {}),
        action: 'SUPPLIER_PAYMENT',
      },
      select: { newData: true },
    }),
  ]);

  let totalRevenueUsd = d(0);
  let totalSalesUsd = d(0);
  let salesCount = 0;
  let discountsUsd = d(0);
  let refundsUsd = d(0);
  let voidedSalesUsd = d(0);
  let voidedCount = 0;
  let cogsUsd = d(0);
  let creditSalesUsd = d(0);
  let posCashCollectedUsd = d(0);

  const periodCashByMethod: Record<'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB', DecimalVal> = {
    CASH: d(0),
    EVC_PLUS: d(0),
    ZAAD: d(0),
    EDAHAB: d(0),
  };

  for (const s of sales) {
    const calc = computeSingleSaleFinancials(s);
    if (calc.isVoided) {
      voidedCount++;
      voidedSalesUsd = voidedSalesUsd.plus(calc.voidedAmountUsd);
      continue;
    }
    salesCount++;
    totalSalesUsd = totalSalesUsd.plus(calc.grossSalesUsd);
    discountsUsd = discountsUsd.plus(calc.discountUsd);
    refundsUsd = refundsUsd.plus(calc.refundsUsd);
    totalRevenueUsd = totalRevenueUsd.plus(calc.netRevenueUsd);
    cogsUsd = cogsUsd.plus(calc.cogsUsd);
    creditSalesUsd = creditSalesUsd.plus(calc.creditSalesUsd);
    posCashCollectedUsd = posCashCollectedUsd.plus(calc.posCashCollectedUsd);

    periodCashByMethod.CASH = periodCashByMethod.CASH.plus(calc.methodCashBreakdown.CASH);
    periodCashByMethod.EVC_PLUS = periodCashByMethod.EVC_PLUS.plus(
      calc.methodCashBreakdown.EVC_PLUS
    );
    periodCashByMethod.ZAAD = periodCashByMethod.ZAAD.plus(calc.methodCashBreakdown.ZAAD);
    periodCashByMethod.EDAHAB = periodCashByMethod.EDAHAB.plus(calc.methodCashBreakdown.EDAHAB);
  }

  let customerPaymentsUsd = d(0);
  for (const rep of creditRepayments) {
    const amt = d(rep.amountDeltaUsd).abs();
    customerPaymentsUsd = customerPaymentsUsd.plus(amt);
    const m = (rep.paymentMethod || 'CASH') as 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
    if (periodCashByMethod[m]) {
      periodCashByMethod[m] = periodCashByMethod[m].plus(amt);
    } else {
      periodCashByMethod.CASH = periodCashByMethod.CASH.plus(amt);
    }
  }

  let totalPurchasesUsd = d(0);
  let supplierPaymentsUsd = d(0);
  for (const pur of purchases) {
    totalPurchasesUsd = totalPurchasesUsd.plus(d(pur.totalAmountUsd));
    supplierPaymentsUsd = supplierPaymentsUsd.plus(d(pur.paidAmountUsd));
  }
  for (const log of supplierPaymentLogs) {
    const nd = (log.newData || {}) as Record<string, unknown>;
    supplierPaymentsUsd = supplierPaymentsUsd.plus(d(nd.amountPaidUsd as number));
  }

  let totalExpensesUsd = d(0);
  let pendingExpensesUsd = d(0);
  for (const exp of expenses) {
    if (exp.approvalStatus === 'APPROVED') {
      totalExpensesUsd = totalExpensesUsd.plus(d(exp.amountUsd));
    } else if (exp.approvalStatus === 'PENDING') {
      pendingExpensesUsd = pendingExpensesUsd.plus(d(exp.amountUsd));
    }
  }

  let inventoryShrinkageUsd = d(0);
  for (const mov of stockAdjustments) {
    if (mov.quantityDelta < 0) {
      inventoryShrinkageUsd = inventoryShrinkageUsd.plus(
        d(Math.abs(mov.quantityDelta)).mul(d(mov.unitCostUsd))
      );
    }
  }

  const grossProfitUsd = totalRevenueUsd.minus(cogsUsd);
  const netProfitUsd = grossProfitUsd.minus(totalExpensesUsd);
  const grossMarginPct = totalRevenueUsd.gt(0)
    ? grossProfitUsd.div(totalRevenueUsd).mul(100)
    : d(0);
  const netMarginPct = totalRevenueUsd.gt(0)
    ? netProfitUsd.div(totalRevenueUsd).mul(100)
    : d(0);

  const cashInflowUsd = posCashCollectedUsd.plus(customerPaymentsUsd);
  const cashOutflowUsd = totalExpensesUsd.plus(supplierPaymentsUsd);
  const netCashFlowUsd = cashInflowUsd.minus(cashOutflowUsd);

  // All-time cumulative Cash Balance across the branch scope
  let allTimeCashIn = d(0);
  for (const s of allTimeSales) {
    const c = computeSingleSaleFinancials(s);
    allTimeCashIn = allTimeCashIn.plus(c.posCashCollectedUsd);
  }
  for (const rep of allTimeRepayments) {
    allTimeCashIn = allTimeCashIn.plus(d(rep.amountDeltaUsd).abs());
  }
  let allTimeCashOut = d(0);
  for (const pur of allTimePurchases) {
    allTimeCashOut = allTimeCashOut.plus(d(pur.paidAmountUsd));
  }
  for (const exp of allTimeExpenses) {
    allTimeCashOut = allTimeCashOut.plus(d(exp.amountUsd));
  }
  for (const log of allTimeSupplierPaymentLogs) {
    const nd = (log.newData || {}) as Record<string, unknown>;
    allTimeCashOut = allTimeCashOut.plus(d(nd.amountPaidUsd as number));
  }
  const cashBalanceUsd = allTimeCashIn.minus(allTimeCashOut);

  let outstandingReceivablesUsd = d(0);
  for (const c of customers) {
    if (d(c.currentBalanceUsd).gt(0)) {
      outstandingReceivablesUsd = outstandingReceivablesUsd.plus(d(c.currentBalanceUsd));
    }
  }

  let outstandingPayablesUsd = d(0);
  for (const sup of suppliers) {
    if (d(sup.balanceUsd).gt(0)) {
      outstandingPayablesUsd = outstandingPayablesUsd.plus(d(sup.balanceUsd));
    }
  }

  return {
    totalRevenueUsd: round2(totalRevenueUsd),
    totalSalesUsd: round2(totalSalesUsd),
    salesCount,
    discountsUsd: round2(discountsUsd),
    refundsUsd: round2(refundsUsd),
    voidedSalesUsd: round2(voidedSalesUsd),
    voidedCount,
    cogsUsd: round2(cogsUsd),
    grossProfitUsd: round2(grossProfitUsd),
    grossMarginPct: round2(grossMarginPct),
    totalPurchasesUsd: round2(totalPurchasesUsd),
    purchasesCount: purchases.length,
    totalExpensesUsd: round2(totalExpensesUsd),
    pendingExpensesUsd: round2(pendingExpensesUsd),
    inventoryShrinkageUsd: round2(inventoryShrinkageUsd),
    netProfitUsd: round2(netProfitUsd),
    netMarginPct: round2(netMarginPct),
    creditSalesUsd: round2(creditSalesUsd),
    posCashCollectedUsd: round2(posCashCollectedUsd),
    customerPaymentsUsd: round2(customerPaymentsUsd),
    supplierPaymentsUsd: round2(supplierPaymentsUsd),
    cashInflowUsd: round2(cashInflowUsd),
    cashOutflowUsd: round2(cashOutflowUsd),
    netCashFlowUsd: round2(netCashFlowUsd),
    cashBalanceUsd: round2(cashBalanceUsd),
    cashByMethod: {
      CASH: round2(periodCashByMethod.CASH),
      EVC_PLUS: round2(periodCashByMethod.EVC_PLUS),
      ZAAD: round2(periodCashByMethod.ZAAD),
      EDAHAB: round2(periodCashByMethod.EDAHAB),
    },
    outstandingReceivablesUsd: round2(outstandingReceivablesUsd),
    outstandingPayablesUsd: round2(outstandingPayablesUsd),
  };
}

/**
 * Generates the complete, multi-module integrated Financial Report with:
 * - Combined filtering (Date Preset/Custom, Branch, Transaction Type, Payment Method, Employee, Status, Search)
 * - 11 Executive Financial KPIs (Decimal accuracy)
 * - Daily, Weekly & Monthly Trend Series
 * - Consolidated & Per-Branch (B1, B2, B3) Financial Comparison
 * - Unified Financial Transactions Ledger across all 9 activity types
 * - Accounts Receivable (Aging) & Accounts Payable (Supplier Balances)
 * - Midnight Rollover history
 */
export async function generateFullFinancialReport(
  filters: FinancialReportQueryFilters,
  now: Date = new Date()
): Promise<FullFinancialReportResponse> {
  const window = resolveMogadishuDateWindow(
    filters.preset,
    filters.fromDate,
    filters.toDate,
    now
  );

  const branchIdFilter =
    filters.branchId && filters.branchId !== 'ALL' ? filters.branchId : undefined;
  const txTypeFilter = (filters.transactionType || 'ALL').toUpperCase();
  const paymentMethodFilter = (filters.paymentMethod || 'ALL').toUpperCase();
  const employeeIdFilter =
    filters.employeeId && filters.employeeId !== 'ALL' ? filters.employeeId : undefined;
  const statusFilter = (filters.status || 'ALL').toUpperCase();
  const searchFilter = (filters.search || '').trim().toLowerCase();

  const branchWhere = branchIdFilter ? { branchId: branchIdFilter, deletedAt: null } : { deletedAt: null };

  // Also fetch 90 days of history for Daily (14d), Weekly (8w), and Monthly (6m) trend charts
  const chartHistoryStartUtc = mogadishuDayStartUtc(
    addDaysToDateString(toMogadishuDateString(now), -150)
  );
  const queryStartUtc =
    window.startUtc < chartHistoryStartUtc ? window.startUtc : chartHistoryStartUtc;

  const [
    branches,
    users,
    sales,
    purchases,
    expenses,
    creditEntries,
    supplierPaymentLogs,
    stockMovements,
    stockTransfers,
    products,
    customers,
    suppliers,
    rolloverLogs,
    prevKpis,
    allTimeCashKpis,
  ] = await Promise.all([
    prisma.branch.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } }),
    prisma.user.findMany({
      where: { deletedAt: null },
      include: { role: true, branch: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    }),
    prisma.sale.findMany({
      where: {
        ...branchWhere,
        soldAt: { gte: queryStartUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        cashier: { select: { id: true, fullName: true, username: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        payments: true,
      },
      orderBy: { soldAt: 'desc' },
    }),
    prisma.purchase.findMany({
      where: {
        ...branchWhere,
        purchaseDate: { gte: queryStartUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { purchaseDate: 'desc' },
    }),
    prisma.expense.findMany({
      where: {
        ...branchWhere,
        expenseDate: { gte: queryStartUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { expenseDate: 'desc' },
    }),
    prisma.creditLedger.findMany({
      where: {
        ...branchWhere,
        createdAt: { gte: queryStartUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        sale: { select: { id: true, receiptNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: {
        ...(branchIdFilter ? { branchId: branchIdFilter } : {}),
        action: 'SUPPLIER_PAYMENT',
        createdAt: { gte: queryStartUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.stockMovement.findMany({
      where: {
        ...branchWhere,
        type: {
          in: [
            'DAMAGE_EXPIRED',
            'ADJUSTMENT_MINUS',
            'ADJUSTMENT_PLUS',
            'STOCK_TAKE_VARIANCE',
            'REFUND_RETURN',
          ],
        },
        createdAt: { gte: window.startUtc, lte: window.endUtc },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, name: true, sku: true } },
        batch: { select: { id: true, batchNumber: true } },
        user: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.stockTransfer.findMany({
      where: {
        deletedAt: null,
        ...(branchIdFilter
          ? { OR: [{ branchId: branchIdFilter }, { destinationBranchId: branchIdFilter }] }
          : {}),
        createdAt: { gte: window.startUtc, lte: window.endUtc },
      },
      include: {
        sourceBranch: { select: { id: true, code: true, name: true } },
        destinationBranch: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.findMany({
      where: branchWhere,
      include: {
        batches: { where: { deletedAt: null } },
      },
    }),
    prisma.customer.findMany({
      where: branchWhere,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        creditEntries: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { currentBalanceUsd: 'desc' },
    }),
    prisma.supplier.findMany({
      where: branchWhere,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        purchases: { where: { deletedAt: null } },
      },
      orderBy: { balanceUsd: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: {
        action: 'MIDNIGHT_ROLLOVER_CLOSE',
        ...(branchIdFilter ? { branchId: branchIdFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    }),
    computePeriodSummaryKpis(window.prevStartUtc, window.prevEndUtc, branchIdFilter),
    computePeriodSummaryKpis(window.startUtc, window.endUtc, branchIdFilter),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  // Filter records to the active [window.startUtc, window.endUtc]
  const inPeriod = (dt: Date) => dt >= window.startUtc && dt <= window.endUtc;

  // Build Unified Financial Transactions List
  const rawTransactions: UnifiedFinancialTransaction[] = [];

  // 1. Sales, Credit Sales, Refunds & Voided Sales
  for (const s of sales) {
    if (!inPeriod(s.soldAt)) continue;
    const calc = computeSingleSaleFinancials(s);
    const primaryMethod =
      s.payments.length === 0
        ? 'CASH'
        : s.payments.length === 1
        ? s.payments[0].method
        : s.payments.map((p) => p.method).join('+');

    const isCreditSale = calc.creditSalesUsd.gt(0) && calc.posCashCollectedUsd.eq(0);
    const txType: UnifiedFinancialTransaction['type'] = isCreditSale ? 'CREDIT_SALE' : 'SALE';

    rawTransactions.push({
      id: `sale-${s.id}`,
      date: s.soldAt.toISOString(),
      mogadishuDate: toMogadishuDateString(s.soldAt),
      mogadishuTime: toMogadishuTimeString(s.soldAt),
      type: txType,
      referenceNumber: s.receiptNumber,
      branchId: s.branchId,
      branchCode: s.branch?.code || 'BX',
      branchName: s.branch?.name || 'Baxnaano',
      partyName: s.customer?.name || 'Walk-in Customer',
      employeeId: s.cashierId,
      employeeName: s.cashier?.fullName || s.cashier?.username || 'Cashier',
      paymentMethod: primaryMethod,
      status: s.status,
      grossAmountUsd: round2(d(s.totalUsd)),
      discountUsd: round2(d(s.discountUsd)),
      netAmountUsd: calc.isVoided ? 0 : round2(calc.netRevenueUsd),
      cashImpactUsd: calc.isVoided ? 0 : round2(calc.posCashCollectedUsd),
      revenueImpactUsd: calc.isVoided ? 0 : round2(calc.netRevenueUsd),
      profitImpactUsd: calc.isVoided ? 0 : round2(calc.grossProfitUsd),
      description: calc.isVoided
        ? `VOIDED POS Sale #${s.receiptNumber} (${s.voidOrRefundReason || 'Cancelled'})`
        : `POS ${isCreditSale ? 'Credit ' : ''}Sale #${s.receiptNumber} (${s.items.length} item${
            s.items.length === 1 ? '' : 's'
          })${calc.creditSalesUsd.gt(0) ? ` [Credit: $${round2(calc.creditSalesUsd).toFixed(2)}]` : ''}`,
      sourceModule: '/sales-history',
      isExcludedFromTotals: calc.isVoided,
    });

    // If sale has refunded items, also surface an explicit REFUND record so filtering by REFUND shows it clearly
    if (!calc.isVoided && calc.refundsUsd.gt(0)) {
      rawTransactions.push({
        id: `refund-${s.id}`,
        date: s.updatedAt.toISOString(),
        mogadishuDate: toMogadishuDateString(s.updatedAt),
        mogadishuTime: toMogadishuTimeString(s.updatedAt),
        type: 'REFUND',
        referenceNumber: `${s.receiptNumber}-REF`,
        branchId: s.branchId,
        branchCode: s.branch?.code || 'BX',
        branchName: s.branch?.name || 'Baxnaano',
        partyName: s.customer?.name || 'Walk-in Customer',
        employeeId: s.approvedById || s.cashierId,
        employeeName:
          (s.approvedById && userMap.get(s.approvedById)?.fullName) ||
          s.cashier?.fullName ||
          'Cashier',
        paymentMethod: primaryMethod.includes('CREDIT') ? 'CREDIT' : 'CASH',
        status: s.status,
        grossAmountUsd: round2(calc.refundsUsd),
        discountUsd: 0,
        netAmountUsd: -round2(calc.refundsUsd),
        cashImpactUsd: -round2(calc.refundsUsd),
        revenueImpactUsd: -round2(calc.refundsUsd),
        profitImpactUsd: -round2(calc.refundsUsd),
        description: `Customer Return / Refund on #${s.receiptNumber}: ${
          s.voidOrRefundReason || 'Item Return'
        }`,
        sourceModule: '/sales-history',
        isExcludedFromTotals: true, // Already netted in the parent sale's netRevenueUsd to prevent double deduction
      });
    }
  }

  // 2. Customer Credit Repayments / Collections
  for (const ce of creditEntries) {
    if (!inPeriod(ce.createdAt)) continue;
    if (ce.type !== 'PAYMENT') continue;

    const amt = round2(d(ce.amountDeltaUsd).abs());
    const recorder = userMap.get(ce.recordedById);
    rawTransactions.push({
      id: `credpay-${ce.id}`,
      date: ce.createdAt.toISOString(),
      mogadishuDate: toMogadishuDateString(ce.createdAt),
      mogadishuTime: toMogadishuTimeString(ce.createdAt),
      type: 'CUSTOMER_PAYMENT',
      referenceNumber: ce.sale?.receiptNumber
        ? `COL-${ce.sale.receiptNumber}`
        : `COL-${ce.id.slice(0, 8).toUpperCase()}`,
      branchId: ce.branchId,
      branchCode: ce.branch?.code || 'BX',
      branchName: ce.branch?.name || 'Baxnaano',
      partyName: ce.customer?.name || 'Credit Customer',
      employeeId: ce.recordedById,
      employeeName: recorder?.fullName || recorder?.username || 'Staff',
      paymentMethod: ce.paymentMethod || 'CASH',
      status: 'COMPLETED',
      grossAmountUsd: amt,
      discountUsd: 0,
      netAmountUsd: amt,
      cashImpactUsd: amt, // Increases Cash Inflow
      revenueImpactUsd: 0, // Never counted as new sales revenue
      profitImpactUsd: 0,
      description: ce.notes || `Customer Credit Repayment (${ce.customer?.name || 'Debtor'})`,
      sourceModule: '/credit',
      isExcludedFromTotals: false,
    });
  }

  // 3. Supplier Purchases & Initial Supplier Payments
  for (const pur of purchases) {
    if (!inPeriod(pur.purchaseDate)) continue;
    const totalAmt = round2(d(pur.totalAmountUsd));
    const paidAmt = round2(d(pur.paidAmountUsd));
    const unpaidAmt = round2(d(pur.totalAmountUsd).minus(d(pur.paidAmountUsd)));
    const receiver = userMap.get(pur.receivedById);

    rawTransactions.push({
      id: `pur-${pur.id}`,
      date: pur.purchaseDate.toISOString(),
      mogadishuDate: toMogadishuDateString(pur.purchaseDate),
      mogadishuTime: toMogadishuTimeString(pur.purchaseDate),
      type: 'PURCHASE',
      referenceNumber: pur.invoiceNumber,
      branchId: pur.branchId,
      branchCode: pur.branch?.code || 'BX',
      branchName: pur.branch?.name || 'Baxnaano',
      partyName: pur.supplier?.name || 'Supplier',
      employeeId: pur.receivedById,
      employeeName: receiver?.fullName || receiver?.username || 'Inventory Officer',
      paymentMethod: unpaidAmt > 0 ? (paidAmt > 0 ? 'CASH+CREDIT' : 'CREDIT') : 'CASH',
      status: unpaidAmt > 0 ? (paidAmt > 0 ? 'PARTIAL' : 'PENDING') : 'COMPLETED',
      grossAmountUsd: totalAmt,
      discountUsd: 0,
      netAmountUsd: totalAmt,
      cashImpactUsd: -paidAmt,
      revenueImpactUsd: 0,
      profitImpactUsd: 0,
      description: `Stock-In Purchase Invoice #${pur.invoiceNumber} from ${
        pur.supplier?.name || 'Supplier'
      } (Paid: $${paidAmt.toFixed(2)}, Payable: $${unpaidAmt.toFixed(2)})`,
      sourceModule: '/inventory',
      isExcludedFromTotals: false,
    });
  }

  // 4. Standalone Supplier Payments (Accounts Payable Settlements)
  for (const log of supplierPaymentLogs) {
    if (!inPeriod(log.createdAt)) continue;
    const nd = (log.newData || {}) as Record<string, unknown>;
    const amt = round2(d(nd.amountPaidUsd as number));
    if (amt <= 0) continue;

    rawTransactions.push({
      id: `suppay-${log.id}`,
      date: log.createdAt.toISOString(),
      mogadishuDate: toMogadishuDateString(log.createdAt),
      mogadishuTime: toMogadishuTimeString(log.createdAt),
      type: 'SUPPLIER_PAYMENT',
      referenceNumber: String(nd.referenceNumber || `SUP-PAY-${log.id.slice(0, 6).toUpperCase()}`),
      branchId: log.branchId || '',
      branchCode: log.branch?.code || 'BX',
      branchName: log.branch?.name || 'Baxnaano',
      partyName: String(nd.supplierName || 'Supplier'),
      employeeId: log.userId,
      employeeName: log.user?.fullName || log.user?.username || 'Admin',
      paymentMethod: String(nd.paymentMethod || 'CASH'),
      status: 'COMPLETED',
      grossAmountUsd: amt,
      discountUsd: 0,
      netAmountUsd: amt,
      cashImpactUsd: -amt,
      revenueImpactUsd: 0,
      profitImpactUsd: 0,
      description:
        log.reason || `Supplier Payable Settlement to ${String(nd.supplierName || 'Supplier')}`,
      sourceModule: '/inventory',
      isExcludedFromTotals: false,
    });
  }

  // 5. Operating Expenses
  for (const exp of expenses) {
    if (!inPeriod(exp.expenseDate)) continue;
    const amt = round2(d(exp.amountUsd));
    const isApproved = exp.approvalStatus === 'APPROVED';

    rawTransactions.push({
      id: `exp-${exp.id}`,
      date: exp.expenseDate.toISOString(),
      mogadishuDate: toMogadishuDateString(exp.expenseDate),
      mogadishuTime: toMogadishuTimeString(exp.expenseDate),
      type: 'EXPENSE',
      referenceNumber: `EXP-${exp.id.slice(0, 8).toUpperCase()}`,
      branchId: exp.branchId,
      branchCode: exp.branch?.code || 'BX',
      branchName: exp.branch?.name || 'Baxnaano',
      partyName: exp.payee,
      employeeId: exp.createdById,
      employeeName: exp.createdBy?.fullName || exp.createdBy?.username || 'Staff',
      paymentMethod: exp.paymentMethod,
      status: exp.approvalStatus,
      grossAmountUsd: amt,
      discountUsd: 0,
      netAmountUsd: amt,
      cashImpactUsd: isApproved ? -amt : 0,
      revenueImpactUsd: 0,
      profitImpactUsd: isApproved ? -amt : 0,
      description: `[${exp.category}] ${exp.payee}${
        exp.description ? ` — ${exp.description}` : ''
      }`,
      sourceModule: '/expenses',
      isExcludedFromTotals: !isApproved,
    });
  }

  // 6. Inventory Adjustments, Damages & Stock-Take Variances
  for (const mov of stockMovements) {
    if (mov.type === 'REFUND_RETURN') continue; // Already represented in sale refunds
    if (mov.quantityDelta === 0) continue; // Metadata-only product edit with 0 stock delta
    const unitCost = d(mov.unitCostUsd);
    const valUsd = round2(unitCost.mul(Math.abs(mov.quantityDelta)));
    const isLoss = mov.quantityDelta < 0;

    rawTransactions.push({
      id: `adj-${mov.id}`,
      date: mov.createdAt.toISOString(),
      mogadishuDate: toMogadishuDateString(mov.createdAt),
      mogadishuTime: toMogadishuTimeString(mov.createdAt),
      type: 'INVENTORY_ADJUSTMENT',
      referenceNumber: `MOV-${mov.id.slice(0, 8).toUpperCase()}`,
      branchId: mov.branchId,
      branchCode: mov.branch?.code || 'BX',
      branchName: mov.branch?.name || 'Baxnaano',
      partyName: `${mov.product?.name || 'Product'} (#${mov.batch?.batchNumber || 'Batch'})`,
      employeeId: mov.userId,
      employeeName: mov.user?.fullName || mov.user?.username || 'Staff',
      paymentMethod: 'N/A',
      status: 'COMPLETED',
      grossAmountUsd: valUsd,
      discountUsd: 0,
      netAmountUsd: isLoss ? -valUsd : valUsd,
      cashImpactUsd: 0,
      revenueImpactUsd: 0,
      profitImpactUsd: isLoss ? -valUsd : 0,
      description: `${mov.type}: ${mov.quantityDelta > 0 ? `+${mov.quantityDelta}` : mov.quantityDelta} units of ${
        mov.product?.name || 'Item'
      } (${mov.reason || 'Adjustment'})`,
      sourceModule: '/inventory',
      isExcludedFromTotals: false,
    });
  }

  // 7. Inter-Branch Stock Transfers (B1 <-> B2 <-> B3)
  for (const trf of stockTransfers) {
    const itemsArr = Array.isArray(trf.items)
      ? (trf.items as Array<{ quantity?: number; buyPriceUsd?: number }>)
      : [];
    const totalTransferCost = itemsArr.reduce(
      (acc, it) => acc.plus(d(it.quantity || 0).mul(d(it.buyPriceUsd || 0))),
      d(0)
    );
    const initiator = userMap.get(trf.initiatedById);

    rawTransactions.push({
      id: `trf-${trf.id}`,
      date: trf.createdAt.toISOString(),
      mogadishuDate: toMogadishuDateString(trf.createdAt),
      mogadishuTime: toMogadishuTimeString(trf.createdAt),
      type: 'BRANCH_TRANSFER',
      referenceNumber: trf.transferNumber,
      branchId: trf.branchId,
      branchCode: `${trf.sourceBranch?.code || 'B?'}→${trf.destinationBranch?.code || 'B?'}`,
      branchName: `${trf.sourceBranch?.name || ''} to ${trf.destinationBranch?.name || ''}`,
      partyName: `${trf.sourceBranch?.code || ''} → ${trf.destinationBranch?.code || ''}`,
      employeeId: trf.initiatedById,
      employeeName: initiator?.fullName || initiator?.username || 'Officer',
      paymentMethod: 'INTERNAL',
      status: trf.status,
      grossAmountUsd: round2(totalTransferCost),
      discountUsd: 0,
      netAmountUsd: round2(totalTransferCost),
      cashImpactUsd: 0,
      revenueImpactUsd: 0,
      profitImpactUsd: 0,
      description: `Inter-Branch Stock Transfer ${trf.transferNumber} (${itemsArr.length} batch line(s))`,
      sourceModule: '/inventory',
      isExcludedFromTotals: false,
    });
  }

  // Apply combined dynamic filters to transactions AND recalculate filtered KPIs when sub-filters are active
  const filteredTransactions = rawTransactions
    .filter((tx) => {
      if (txTypeFilter !== 'ALL' && tx.type !== txTypeFilter) return false;
      if (paymentMethodFilter !== 'ALL' && !tx.paymentMethod.includes(paymentMethodFilter)) {
        return false;
      }
      if (employeeIdFilter && tx.employeeId !== employeeIdFilter) return false;
      if (statusFilter !== 'ALL' && tx.status.toUpperCase() !== statusFilter) return false;
      if (searchFilter) {
        const hay = `${tx.referenceNumber} ${tx.partyName} ${tx.employeeName} ${tx.description} ${tx.branchCode} ${tx.type}`.toLowerCase();
        if (!hay.includes(searchFilter)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Determine if sub-filters (employee, paymentMethod, transactionType, status, search) are active;
  // if so, adjust KPIs dynamically to match the filtered subset while preserving balance-sheet metrics
  const hasSubFilter =
    txTypeFilter !== 'ALL' ||
    paymentMethodFilter !== 'ALL' ||
    Boolean(employeeIdFilter) ||
    statusFilter !== 'ALL' ||
    Boolean(searchFilter);

  const kpis: FinancialSummaryKpis = { ...allTimeCashKpis };
  if (hasSubFilter) {
    let fRev = d(0);
    let fSales = d(0);
    let fSalesCount = 0;
    let fDisc = d(0);
    let fRef = d(0);
    let fVoid = d(0);
    let fVoidCount = 0;
    let fCogs = d(0);
    let fPur = d(0);
    let fPurCount = 0;
    let fExp = d(0);
    let fPendExp = d(0);
    let fShrink = d(0);
    let fCreditSales = d(0);
    let fPosCash = d(0);
    let fCustPay = d(0);
    let fSupPay = d(0);

    for (const tx of filteredTransactions) {
      if (tx.type === 'SALE' || tx.type === 'CREDIT_SALE') {
        if (tx.status === 'VOIDED') {
          fVoidCount++;
          fVoid = fVoid.plus(d(tx.grossAmountUsd));
        } else {
          fSalesCount++;
          fSales = fSales.plus(d(tx.grossAmountUsd));
          fDisc = fDisc.plus(d(tx.discountUsd));
          fRev = fRev.plus(d(tx.revenueImpactUsd));
          const txCogs = d(tx.revenueImpactUsd).minus(d(tx.profitImpactUsd));
          fCogs = fCogs.plus(txCogs);
          fPosCash = fPosCash.plus(d(tx.cashImpactUsd));
          const credPortion = Decimal.max(
            d(0),
            d(tx.netAmountUsd).minus(d(tx.cashImpactUsd))
          );
          fCreditSales = fCreditSales.plus(credPortion);
        }
      } else if (tx.type === 'REFUND') {
        fRef = fRef.plus(d(tx.grossAmountUsd));
      } else if (tx.type === 'CUSTOMER_PAYMENT') {
        fCustPay = fCustPay.plus(d(tx.netAmountUsd));
      } else if (tx.type === 'PURCHASE') {
        fPurCount++;
        fPur = fPur.plus(d(tx.grossAmountUsd));
        fSupPay = fSupPay.plus(d(tx.cashImpactUsd).abs());
      } else if (tx.type === 'SUPPLIER_PAYMENT') {
        fSupPay = fSupPay.plus(d(tx.cashImpactUsd).abs());
      } else if (tx.type === 'EXPENSE') {
        if (tx.status === 'APPROVED') fExp = fExp.plus(d(tx.grossAmountUsd));
        else if (tx.status === 'PENDING') fPendExp = fPendExp.plus(d(tx.grossAmountUsd));
      } else if (tx.type === 'INVENTORY_ADJUSTMENT' && tx.netAmountUsd < 0) {
        fShrink = fShrink.plus(d(tx.grossAmountUsd));
      }
    }

    const fGrossProfit = fRev.minus(fCogs);
    const fNetProfit = fGrossProfit.minus(fExp);
    const fCashIn = fPosCash.plus(fCustPay);
    const fCashOut = fExp.plus(fSupPay);

    kpis.totalRevenueUsd = round2(fRev);
    kpis.totalSalesUsd = round2(fSales);
    kpis.salesCount = fSalesCount;
    kpis.discountsUsd = round2(fDisc);
    kpis.refundsUsd = round2(fRef);
    kpis.voidedSalesUsd = round2(fVoid);
    kpis.voidedCount = fVoidCount;
    kpis.cogsUsd = round2(fCogs);
    kpis.grossProfitUsd = round2(fGrossProfit);
    kpis.grossMarginPct = fRev.gt(0) ? round2(fGrossProfit.div(fRev).mul(100)) : 0;
    kpis.totalPurchasesUsd = round2(fPur);
    kpis.purchasesCount = fPurCount;
    kpis.totalExpensesUsd = round2(fExp);
    kpis.pendingExpensesUsd = round2(fPendExp);
    kpis.inventoryShrinkageUsd = round2(fShrink);
    kpis.netProfitUsd = round2(fNetProfit);
    kpis.netMarginPct = fRev.gt(0) ? round2(fNetProfit.div(fRev).mul(100)) : 0;
    kpis.creditSalesUsd = round2(fCreditSales);
    kpis.posCashCollectedUsd = round2(fPosCash);
    kpis.customerPaymentsUsd = round2(fCustPay);
    kpis.supplierPaymentsUsd = round2(fSupPay);
    kpis.cashInflowUsd = round2(fCashIn);
    kpis.cashOutflowUsd = round2(fCashOut);
    kpis.netCashFlowUsd = round2(fCashIn.minus(fCashOut));
  }

  // Build Daily (last 14 days), Weekly (last 8 weeks), and Monthly (last 6 months) Trend Series
  const todayMogStr = toMogadishuDateString(now);

  const createEmptyPoint = (date: string, label: string): FinancialTrendPoint => ({
    date,
    label,
    salesUsd: 0,
    revenueUsd: 0,
    purchasesUsd: 0,
    expensesUsd: 0,
    grossProfitUsd: 0,
    netProfitUsd: 0,
    cashInflowUsd: 0,
    cashOutflowUsd: 0,
    netCashFlowUsd: 0,
    creditSalesUsd: 0,
    customerPaymentsUsd: 0,
  });

  const dailyMap = new Map<string, FinancialTrendPoint>();
  for (let i = 13; i >= 0; i--) {
    const ds = addDaysToDateString(todayMogStr, -i);
    dailyMap.set(ds, createEmptyPoint(ds, ds.slice(5)));
  }

  const weeklyMap = new Map<string, FinancialTrendPoint>();
  const refTodayNoon = new Date(`${todayMogStr}T12:00:00.000Z`);
  const curMondayStr = addDaysToDateString(todayMogStr, -((refTodayNoon.getUTCDay() + 6) % 7));
  for (let w = 7; w >= 0; w--) {
    const wkStart = addDaysToDateString(curMondayStr, -w * 7);
    weeklyMap.set(wkStart, createEmptyPoint(wkStart, `Wk ${wkStart.slice(5)}`));
  }

  const monthlyMap = new Map<string, FinancialTrendPoint>();
  const [curYr, curMo] = todayMogStr.slice(0, 7).split('-').map(Number);
  for (let m = 5; m >= 0; m--) {
    const dt = new Date(Date.UTC(curYr, curMo - 1 - m, 1));
    const ym = dt.toISOString().slice(0, 7);
    monthlyMap.set(ym, createEmptyPoint(ym, ym));
  }

  const getWeekMonday = (dateStr: string) => {
    const dt = new Date(`${dateStr}T12:00:00.000Z`);
    return addDaysToDateString(dateStr, -((dt.getUTCDay() + 6) % 7));
  };

  const addToPoint = (
    pt: FinancialTrendPoint | undefined,
    delta: Partial<Omit<FinancialTrendPoint, 'date' | 'label'>>
  ) => {
    if (!pt) return;
    if (delta.salesUsd) pt.salesUsd = round2(d(pt.salesUsd).plus(d(delta.salesUsd)));
    if (delta.revenueUsd) pt.revenueUsd = round2(d(pt.revenueUsd).plus(d(delta.revenueUsd)));
    if (delta.purchasesUsd)
      pt.purchasesUsd = round2(d(pt.purchasesUsd).plus(d(delta.purchasesUsd)));
    if (delta.expensesUsd) pt.expensesUsd = round2(d(pt.expensesUsd).plus(d(delta.expensesUsd)));
    if (delta.grossProfitUsd)
      pt.grossProfitUsd = round2(d(pt.grossProfitUsd).plus(d(delta.grossProfitUsd)));
    if (delta.cashInflowUsd)
      pt.cashInflowUsd = round2(d(pt.cashInflowUsd).plus(d(delta.cashInflowUsd)));
    if (delta.cashOutflowUsd)
      pt.cashOutflowUsd = round2(d(pt.cashOutflowUsd).plus(d(delta.cashOutflowUsd)));
    if (delta.creditSalesUsd)
      pt.creditSalesUsd = round2(d(pt.creditSalesUsd).plus(d(delta.creditSalesUsd)));
    if (delta.customerPaymentsUsd)
      pt.customerPaymentsUsd = round2(
        d(pt.customerPaymentsUsd).plus(d(delta.customerPaymentsUsd))
      );
    pt.netProfitUsd = round2(d(pt.grossProfitUsd).minus(d(pt.expensesUsd)));
    pt.netCashFlowUsd = round2(d(pt.cashInflowUsd).minus(d(pt.cashOutflowUsd)));
  };

  for (const s of sales) {
    const calc = computeSingleSaleFinancials(s);
    if (calc.isVoided) continue;
    const ds = toMogadishuDateString(s.soldAt);
    const wk = getWeekMonday(ds);
    const ym = ds.slice(0, 7);
    const delta = {
      salesUsd: round2(calc.grossSalesUsd),
      revenueUsd: round2(calc.netRevenueUsd),
      grossProfitUsd: round2(calc.grossProfitUsd),
      cashInflowUsd: round2(calc.posCashCollectedUsd),
      creditSalesUsd: round2(calc.creditSalesUsd),
    };
    addToPoint(dailyMap.get(ds), delta);
    addToPoint(weeklyMap.get(wk), delta);
    addToPoint(monthlyMap.get(ym), delta);
  }

  for (const ce of creditEntries) {
    if (ce.type !== 'PAYMENT') continue;
    const ds = toMogadishuDateString(ce.createdAt);
    const wk = getWeekMonday(ds);
    const ym = ds.slice(0, 7);
    const amt = round2(d(ce.amountDeltaUsd).abs());
    const delta = { cashInflowUsd: amt, customerPaymentsUsd: amt };
    addToPoint(dailyMap.get(ds), delta);
    addToPoint(weeklyMap.get(wk), delta);
    addToPoint(monthlyMap.get(ym), delta);
  }

  for (const pur of purchases) {
    const ds = toMogadishuDateString(pur.purchaseDate);
    const wk = getWeekMonday(ds);
    const ym = ds.slice(0, 7);
    const delta = {
      purchasesUsd: round2(d(pur.totalAmountUsd)),
      cashOutflowUsd: round2(d(pur.paidAmountUsd)),
    };
    addToPoint(dailyMap.get(ds), delta);
    addToPoint(weeklyMap.get(wk), delta);
    addToPoint(monthlyMap.get(ym), delta);
  }

  for (const exp of expenses) {
    if (exp.approvalStatus !== 'APPROVED') continue;
    const ds = toMogadishuDateString(exp.expenseDate);
    const wk = getWeekMonday(ds);
    const ym = ds.slice(0, 7);
    const amt = round2(d(exp.amountUsd));
    const delta = { expensesUsd: amt, cashOutflowUsd: amt };
    addToPoint(dailyMap.get(ds), delta);
    addToPoint(weeklyMap.get(wk), delta);
    addToPoint(monthlyMap.get(ym), delta);
  }

  // Per-Branch Financial Summaries (B1, B2, B3) for active period
  const branchSummaryMap = new Map<string, BranchFinancialSummary>();
  for (const b of branches) {
    branchSummaryMap.set(b.id, {
      branchId: b.id,
      code: b.code,
      name: b.name,
      type: b.type,
      location: b.location,
      revenueUsd: 0,
      salesUsd: 0,
      purchasesUsd: 0,
      expensesUsd: 0,
      grossProfitUsd: 0,
      netProfitUsd: 0,
      cashInflowUsd: 0,
      cashOutflowUsd: 0,
      netCashFlowUsd: 0,
      creditSalesUsd: 0,
      customerPaymentsUsd: 0,
      supplierPaymentsUsd: 0,
      receivablesUsd: 0,
      payablesUsd: 0,
      inventoryCostValUsd: 0,
      inventoryRetailValUsd: 0,
    });
  }

  for (const s of sales) {
    if (!inPeriod(s.soldAt)) continue;
    const calc = computeSingleSaleFinancials(s);
    if (calc.isVoided) continue;
    const bs = branchSummaryMap.get(s.branchId);
    if (!bs) continue;
    bs.salesUsd = round2(d(bs.salesUsd).plus(calc.grossSalesUsd));
    bs.revenueUsd = round2(d(bs.revenueUsd).plus(calc.netRevenueUsd));
    bs.grossProfitUsd = round2(d(bs.grossProfitUsd).plus(calc.grossProfitUsd));
    bs.cashInflowUsd = round2(d(bs.cashInflowUsd).plus(calc.posCashCollectedUsd));
    bs.creditSalesUsd = round2(d(bs.creditSalesUsd).plus(calc.creditSalesUsd));
  }

  for (const ce of creditEntries) {
    if (!inPeriod(ce.createdAt) || ce.type !== 'PAYMENT') continue;
    const bs = branchSummaryMap.get(ce.branchId);
    if (!bs) continue;
    const amt = d(ce.amountDeltaUsd).abs();
    bs.customerPaymentsUsd = round2(d(bs.customerPaymentsUsd).plus(amt));
    bs.cashInflowUsd = round2(d(bs.cashInflowUsd).plus(amt));
  }

  for (const pur of purchases) {
    if (!inPeriod(pur.purchaseDate)) continue;
    const bs = branchSummaryMap.get(pur.branchId);
    if (!bs) continue;
    bs.purchasesUsd = round2(d(bs.purchasesUsd).plus(d(pur.totalAmountUsd)));
    bs.supplierPaymentsUsd = round2(d(bs.supplierPaymentsUsd).plus(d(pur.paidAmountUsd)));
    bs.cashOutflowUsd = round2(d(bs.cashOutflowUsd).plus(d(pur.paidAmountUsd)));
  }

  for (const log of supplierPaymentLogs) {
    if (!inPeriod(log.createdAt) || !log.branchId) continue;
    const bs = branchSummaryMap.get(log.branchId);
    if (!bs) continue;
    const nd = (log.newData || {}) as Record<string, unknown>;
    const amt = d(nd.amountPaidUsd as number);
    bs.supplierPaymentsUsd = round2(d(bs.supplierPaymentsUsd).plus(amt));
    bs.cashOutflowUsd = round2(d(bs.cashOutflowUsd).plus(amt));
  }

  for (const exp of expenses) {
    if (!inPeriod(exp.expenseDate) || exp.approvalStatus !== 'APPROVED') continue;
    const bs = branchSummaryMap.get(exp.branchId);
    if (!bs) continue;
    const amt = d(exp.amountUsd);
    bs.expensesUsd = round2(d(bs.expensesUsd).plus(amt));
    bs.cashOutflowUsd = round2(d(bs.cashOutflowUsd).plus(amt));
  }

  // Stock Valuation & Product Velocity
  let totalCostValuationUsd = d(0);
  let totalRetailValuationUsd = d(0);
  let totalSellableUnits = 0;
  let totalExpiredUnits = 0;
  let expiredValuationUsd = d(0);

  const productVelocityMap = new Map<string, { qty: number; revUsd: DecimalVal }>();
  for (const s of sales) {
    if (!inPeriod(s.soldAt) || s.status === 'VOIDED') continue;
    for (const item of s.items) {
      const netQty = Math.max(0, item.quantity - item.refundedQuantity);
      if (netQty <= 0) continue;
      const prev = productVelocityMap.get(item.productId) || { qty: 0, revUsd: d(0) };
      prev.qty += netQty;
      prev.revUsd = prev.revUsd.plus(d(item.subtotalUsd));
      productVelocityMap.set(item.productId, prev);
    }
  }

  const movers = products.map((p) => {
    let sellableQty = 0;
    let costVal = d(0);
    let retailVal = d(0);

    for (const b of p.batches) {
      if (b.cachedQuantity <= 0) continue;
      const { bucket } = classifyExpiryBucket(b.expiryDate);
      if (bucket === 'EXPIRED') {
        totalExpiredUnits += b.cachedQuantity;
        expiredValuationUsd = expiredValuationUsd.plus(
          d(b.cachedQuantity).mul(d(b.buyPriceUsd))
        );
      } else {
        sellableQty += b.cachedQuantity;
        totalSellableUnits += b.cachedQuantity;
        const bCost = d(b.cachedQuantity).mul(d(b.buyPriceUsd));
        const bRetail = d(b.cachedQuantity).mul(d(b.sellPriceUsd));
        costVal = costVal.plus(bCost);
        retailVal = retailVal.plus(bRetail);
      }
    }

    totalCostValuationUsd = totalCostValuationUsd.plus(costVal);
    totalRetailValuationUsd = totalRetailValuationUsd.plus(retailVal);

    const bs = branchSummaryMap.get(p.branchId);
    if (bs) {
      bs.inventoryCostValUsd = round2(d(bs.inventoryCostValUsd).plus(costVal));
      bs.inventoryRetailValUsd = round2(d(bs.inventoryRetailValUsd).plus(retailVal));
    }

    const vel = productVelocityMap.get(p.id) || { qty: 0, revUsd: d(0) };
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      stockQty: sellableQty,
      currentStock: sellableQty,
      quantitySoldInPeriod: vel.qty,
      quantitySold: vel.qty,
      revenueUsd: round2(vel.revUsd),
      costValuationUsd: round2(costVal),
      valuationUsd: round2(costVal),
    };
  });

  const fastMovers = [...movers]
    .sort((a, b) => b.quantitySoldInPeriod - a.quantitySoldInPeriod)
    .slice(0, 10);
  const slowMovers = [...movers]
    .filter((m) => m.stockQty > 0)
    .sort((a, b) => a.quantitySoldInPeriod - b.quantitySoldInPeriod)
    .slice(0, 10);

  // Accounts Receivable Aging & Customers
  const creditAgingTotals = {
    totalDueUsd: 0,
    bucket0to30Usd: 0,
    bucket31to60Usd: 0,
    bucket60PlusUsd: 0,
  };

  const receivablesCustomers = customers
    .map((c) => {
      const aging = computeCustomerCreditAging(
        c.creditEntries.map((e) => ({
          id: e.id,
          type: e.type,
          amountDeltaUsd: Number(e.amountDeltaUsd),
          createdAt: e.createdAt,
          dueDate: e.dueDate,
        }))
      );
      const bal = round2(d(c.currentBalanceUsd));
      if (bal > 0) {
        creditAgingTotals.totalDueUsd = round2(
          d(creditAgingTotals.totalDueUsd).plus(d(aging.totalBalanceUsd))
        );
        creditAgingTotals.bucket0to30Usd = round2(
          d(creditAgingTotals.bucket0to30Usd).plus(d(aging.bucket0to30Usd))
        );
        creditAgingTotals.bucket31to60Usd = round2(
          d(creditAgingTotals.bucket31to60Usd).plus(d(aging.bucket31to60Usd))
        );
        creditAgingTotals.bucket60PlusUsd = round2(
          d(creditAgingTotals.bucket60PlusUsd).plus(d(aging.bucket60PlusUsd))
        );
        const bs = branchSummaryMap.get(c.branchId);
        if (bs) {
          bs.receivablesUsd = round2(d(bs.receivablesUsd).plus(d(bal)));
        }
      }
      return {
        id: c.id,
        branchId: c.branchId,
        branchCode: c.branch?.code || 'BX',
        name: c.name,
        phone: c.phone,
        villageOrFarm: c.villageOrFarm,
        creditLimitUsd: round2(d(c.creditLimitUsd)),
        currentBalanceUsd: bal,
        aging,
      };
    })
    .filter((c) => c.currentBalanceUsd > 0);

  // Accounts Payable & Suppliers
  const payablesSuppliers: SupplierPayableSummary[] = suppliers.map((sup) => {
    const totalPurchased = sup.purchases.reduce(
      (acc, p) => acc.plus(d(p.totalAmountUsd)),
      d(0)
    );
    const totalPaid = sup.purchases.reduce((acc, p) => acc.plus(d(p.paidAmountUsd)), d(0));
    const bal = round2(d(sup.balanceUsd));
    const bs = branchSummaryMap.get(sup.branchId);
    if (bs && bal > 0) {
      bs.payablesUsd = round2(d(bs.payablesUsd).plus(d(bal)));
    }
    return {
      id: sup.id,
      branchId: sup.branchId,
      branchCode: sup.branch?.code || 'BX',
      name: sup.name,
      contactPerson: sup.contactPerson,
      phone: sup.phone,
      balanceUsd: bal,
      totalPurchasedUsd: round2(totalPurchased),
      totalPaidUsd: round2(totalPaid),
      purchasesCount: sup.purchases.length,
    };
  });

  for (const bs of branchSummaryMap.values()) {
    bs.netProfitUsd = round2(d(bs.grossProfitUsd).minus(d(bs.expensesUsd)));
    bs.netCashFlowUsd = round2(d(bs.cashInflowUsd).minus(d(bs.cashOutflowUsd)));
  }

  // Staff / Employee Financial Performance
  const staffMap = new Map<
    string,
    {
      employeeId: string;
      fullName: string;
      username: string;
      role: string;
      branchCode: string;
      salesCount: number;
      totalSalesUsd: DecimalVal;
      netRevenueUsd: DecimalVal;
      cashCollectedUsd: DecimalVal;
      creditSalesUsd: DecimalVal;
      expensesRecordedUsd: DecimalVal;
    }
  >();

  for (const u of users) {
    staffMap.set(u.id, {
      employeeId: u.id,
      fullName: u.fullName,
      username: u.username,
      role: u.role.name,
      branchCode: u.branch?.code || 'ALL',
      salesCount: 0,
      totalSalesUsd: d(0),
      netRevenueUsd: d(0),
      cashCollectedUsd: d(0),
      creditSalesUsd: d(0),
      expensesRecordedUsd: d(0),
    });
  }

  for (const s of sales) {
    if (!inPeriod(s.soldAt)) continue;
    const calc = computeSingleSaleFinancials(s);
    if (calc.isVoided) continue;
    const st = staffMap.get(s.cashierId);
    if (!st) continue;
    st.salesCount++;
    st.totalSalesUsd = st.totalSalesUsd.plus(calc.grossSalesUsd);
    st.netRevenueUsd = st.netRevenueUsd.plus(calc.netRevenueUsd);
    st.cashCollectedUsd = st.cashCollectedUsd.plus(calc.posCashCollectedUsd);
    st.creditSalesUsd = st.creditSalesUsd.plus(calc.creditSalesUsd);
  }

  for (const exp of expenses) {
    if (!inPeriod(exp.expenseDate) || exp.approvalStatus !== 'APPROVED') continue;
    const st = staffMap.get(exp.createdById);
    if (!st) continue;
    st.expensesRecordedUsd = st.expensesRecordedUsd.plus(d(exp.amountUsd));
  }

  const staffPerformance = Array.from(staffMap.values())
    .map((st) => ({
      employeeId: st.employeeId,
      fullName: st.fullName,
      username: st.username,
      role: st.role,
      branchCode: st.branchCode,
      salesCount: st.salesCount,
      totalSalesUsd: round2(st.totalSalesUsd),
      netRevenueUsd: round2(st.netRevenueUsd),
      cashCollectedUsd: round2(st.cashCollectedUsd),
      creditSalesUsd: round2(st.creditSalesUsd),
      expensesRecordedUsd: round2(st.expensesRecordedUsd),
    }))
    .sort((a, b) => b.netRevenueUsd - a.netRevenueUsd);

  // Previous Period Comparison percentages
  const pctChange = (cur: number, prev: number) => {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return round2(d(cur - prev).div(Math.abs(prev)).mul(100));
  };

  // Rollover History from AuditLog
  const rolloverHistory: DailyRolloverCloseRecord[] = rolloverLogs.map((log) => {
    const nd = (log.newData || {}) as Record<string, unknown>;
    const b = log.branchId ? branchMap.get(log.branchId) : null;
    return {
      id: log.id,
      businessDate: String(nd.businessDate || log.entityId.split(':').pop() || ''),
      branchId: log.branchId,
      branchCode: b?.code || String(nd.branchCode || 'ALL'),
      closedAt: log.createdAt.toISOString(),
      closedBy: String(nd.closedBy || 'SYSTEM_ROLLOVER'),
      totalSalesUsd: Number(nd.totalSalesUsd || 0),
      totalRevenueUsd: Number(nd.totalRevenueUsd || 0),
      totalPurchasesUsd: Number(nd.totalPurchasesUsd || 0),
      totalExpensesUsd: Number(nd.totalExpensesUsd || 0),
      grossProfitUsd: Number(nd.grossProfitUsd || 0),
      netProfitUsd: Number(nd.netProfitUsd || 0),
      cashInflowUsd: Number(nd.cashInflowUsd || 0),
      cashOutflowUsd: Number(nd.cashOutflowUsd || 0),
      netCashFlowUsd: Number(nd.netCashFlowUsd || 0),
      creditSalesUsd: Number(nd.creditSalesUsd || 0),
      customerPaymentsUsd: Number(nd.customerPaymentsUsd || 0),
      supplierPaymentsUsd: Number(nd.supplierPaymentsUsd || 0),
      transactionCount: Number(nd.transactionCount || 0),
    };
  });

  return {
    timezone: MOGADISHU_TIMEZONE,
    currentMogadishuDate: toMogadishuDateString(now),
    currentMogadishuTime: toMogadishuTimeString(now),
    nextRolloverAtIso: getNextMogadishuMidnightUtc(now).toISOString(),
    appliedFilters: {
      preset: window.preset,
      fromDate: window.fromDateStr,
      toDate: window.toDateStr,
      branchId: branchIdFilter || 'ALL',
      transactionType: txTypeFilter,
      paymentMethod: paymentMethodFilter,
      employeeId: employeeIdFilter || 'ALL',
      status: statusFilter,
      search: filters.search || '',
    },
    kpis,
    comparisonWithPreviousPeriod: {
      previousLabel: window.prevLabel,
      previousRevenueUsd: prevKpis.totalRevenueUsd,
      revenueChangePct: pctChange(kpis.totalRevenueUsd, prevKpis.totalRevenueUsd),
      previousNetProfitUsd: prevKpis.netProfitUsd,
      netProfitChangePct: pctChange(kpis.netProfitUsd, prevKpis.netProfitUsd),
      previousExpensesUsd: prevKpis.totalExpensesUsd,
      expensesChangePct: pctChange(kpis.totalExpensesUsd, prevKpis.totalExpensesUsd),
      previousCashFlowUsd: prevKpis.netCashFlowUsd,
    },
    dailyTrends: Array.from(dailyMap.values()),
    weeklyTrends: Array.from(weeklyMap.values()),
    monthlyTrends: Array.from(monthlyMap.values()),
    branchSummaries: Array.from(branchSummaryMap.values()),
    transactions: filteredTransactions,
    creditAgingTotals,
    receivablesCustomers,
    payablesSuppliers,
    stockValuation: {
      totalCostValuationUsd: round2(totalCostValuationUsd),
      totalRetailValuationUsd: round2(totalRetailValuationUsd),
      projectedMarginUsd: round2(totalRetailValuationUsd.minus(totalCostValuationUsd)),
      totalSellableUnits,
      totalExpiredUnits,
      expiredValuationUsd: round2(expiredValuationUsd),
    },
    fastMovers,
    slowMovers,
    staffPerformance,
    employeesFilterOptions: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      role: u.role.name,
      branchCode: u.branch?.code || null,
    })),
    rolloverHistory,
  };
}


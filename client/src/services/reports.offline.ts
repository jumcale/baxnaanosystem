import {
  db,
  getCurrentSessionUserSync,
  isRecordVisibleToCurrentUser,
} from '../db/dexie';
import {
  BAXNAANO_BRANCHES,
  classifyExpiryBucket,
} from '@baxnaano/shared';
import { getOfflineCustomersWithAging } from './finance.offline';

export interface DashboardAnalytics {
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
  branchComparison: Array<{
    branchId: string;
    code: string;
    name: string;
    type: string;
    location: string;
    todaySalesUsd: number;
    monthSalesUsd: number;
    monthExpensesUsd: number;
    monthNetProfitUsd: number;
  }>;
}

/**
 * Offline-First Dashboard & Branch Comparison Aggregator
 * Computes all KPIs, 7/30-day sales trends, expiry buckets, top sellers, and
 * Admin B1/B2/B3 comparison cards directly from local IndexedDB tables.
 */
export async function computeOfflineDashboardAnalytics(
  activeBranchId: string
): Promise<DashboardAnalytics> {
  const now = new Date();
  // Start of today: 00:00:00.000 in local timezone (resets every 24 hours at local midnight)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const endOfTodayMs = startOfTodayMs + 24 * 60 * 60 * 1000;
  const thirtyDaysAgoMs = startOfTodayMs - 29 * 24 * 60 * 60 * 1000;

  const isWithinToday = (dateValue: unknown): boolean => {
    if (!dateValue) return false;
    const ms = new Date(String(dateValue)).getTime();
    if (isNaN(ms)) return false;
    return ms >= startOfTodayMs && ms < endOfTodayMs;
  };

  const getLocalDateKey = (dateValue: unknown): string => {
    if (!dateValue) return '';
    const d = new Date(String(dateValue));
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const sessionUser = getCurrentSessionUserSync();
  const effectiveBranchId =
    sessionUser && sessionUser.role !== 'ADMIN' && sessionUser.branchId
      ? sessionUser.branchId
      : activeBranchId;
  const isAll = effectiveBranchId === 'ALL';

  const [
    allSales,
    allSaleItems,
    allPayments,
    allExpenses,
    allProducts,
    allBatches,
    allAppointments,
    allTasks,
  ] = await Promise.all([
    db.sales.filter((s) => !s.deletedAt && s.status === 'COMPLETED').toArray(),
    db.saleItems.filter((i) => !i.deletedAt).toArray(),
    db.payments.filter((p) => !p.deletedAt).toArray(),
    db.expenses
      .filter((e) => !e.deletedAt && e.approvalStatus === 'APPROVED')
      .toArray(),
    db.products.filter((p) => !p.deletedAt).toArray(),
    db.batches.filter((b) => !b.deletedAt).toArray(),
    db.appointments.filter((a) => !a.deletedAt).toArray(),
    db.tasks.filter((t) => !t.deletedAt).toArray(),
  ]);

  // Scope datasets to effectiveBranchId and current user ownership
  const scopedSales = (
    isAll ? allSales : allSales.filter((s) => s.branchId === effectiveBranchId)
  ).filter((s) => isRecordVisibleToCurrentUser(s));

  const scopedExpenses = (
    isAll ? allExpenses : allExpenses.filter((e) => e.branchId === effectiveBranchId)
  ).filter((e) => isRecordVisibleToCurrentUser(e));

  const legacyPlaceholderSkus = new Set([
    'B2-IVER-100ML',
    'B2-PPR-VAC',
    'B3-OXY-20LA',
    'B2-IVER-100',
    'B3-IVER-100',
  ]);

  const scopedProducts = (
    isAll ? allProducts : allProducts.filter((p) => p.branchId === effectiveBranchId)
  )
    .filter((p) => isRecordVisibleToCurrentUser(p))
    .filter(
      (p) =>
        !legacyPlaceholderSkus.has(String(p.sku || '').trim()) &&
        !String(p.name || '').includes('Oxytetracycline 20% Long Acting (100ml)')
    );

  const scopedBatches = (
    isAll ? allBatches : allBatches.filter((b) => b.branchId === effectiveBranchId)
  ).filter((b) => isRecordVisibleToCurrentUser(b));

  const scopedAppointments = (
    isAll
      ? allAppointments
      : allAppointments.filter((a) => a.branchId === effectiveBranchId)
  ).filter((a) => isRecordVisibleToCurrentUser(a, ['assignedStaffId', 'createdById']));

  const scopedTasks = (
    isAll ? allTasks : allTasks.filter((t) => t.branchId === effectiveBranchId)
  ).filter((t) => isRecordVisibleToCurrentUser(t, ['assignedToId', 'createdById']));

  const saleItemsBySaleId = new Map<string, Array<Record<string, unknown>>>();
  for (const item of allSaleItems) {
    const sId = String(item.saleId);
    const arr = saleItemsBySaleId.get(sId) || [];
    arr.push(item);
    saleItemsBySaleId.set(sId, arr);
  }

  const paymentsBySaleId = new Map<string, Array<Record<string, unknown>>>();
  for (const pay of allPayments) {
    if (!pay.saleId) continue;
    const sId = String(pay.saleId);
    const arr = paymentsBySaleId.get(sId) || [];
    arr.push(pay);
    paymentsBySaleId.set(sId, arr);
  }

  // Trend Map (30 days)
  const trendMap = new Map<string, { date: string; salesUsd: number; profitUsd: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(startOfTodayMs - i * 24 * 60 * 60 * 1000);
    const key = getLocalDateKey(d);
    trendMap.set(key, { date: key, salesUsd: 0, profitUsd: 0 });
  }

  let todaySalesUsd = 0;
  let todayCogsUsd = 0;
  let todayCashUsd = 0;
  let todayMobileMoneyUsd = 0;
  let todayCreditUsd = 0;

  const topItemsMap = new Map<
    string,
    { productId: string; name: string; sku: string; quantitySold: number; revenueUsd: number }
  >();

  for (const sale of scopedSales) {
    const soldTime = new Date(String(sale.soldAt)).getTime();
    if (isNaN(soldTime) || soldTime < thirtyDaysAgoMs) continue;

    const saleTotal = Number(sale.totalUsd || 0);
    const dateKey = getLocalDateKey(sale.soldAt);
    const isToday = isWithinToday(sale.soldAt);

    const items = saleItemsBySaleId.get(sale.id) || [];
    let saleCogs = 0;

    for (const item of items) {
      const qty = Number(item.quantity || 0) - Number(item.refundedQuantity || 0);
      if (qty <= 0) continue;
      const buyCost = Number(item.unitBuyPriceUsd || 0);
      saleCogs += qty * buyCost;

      const pId = String(item.productId);
      const existingTop = topItemsMap.get(pId) || {
        productId: pId,
        name: String(item.productName || 'Product'),
        sku: String(item.sku || ''),
        quantitySold: 0,
        revenueUsd: 0,
      };
      existingTop.quantitySold += qty;
      existingTop.revenueUsd = Number(
        (existingTop.revenueUsd + Number(item.subtotalUsd || 0)).toFixed(2)
      );
      topItemsMap.set(pId, existingTop);
    }

    const saleGrossProfit = saleTotal - saleCogs;
    const tPoint = trendMap.get(dateKey);
    if (tPoint) {
      tPoint.salesUsd = Number((tPoint.salesUsd + saleTotal).toFixed(2));
      tPoint.profitUsd = Number((tPoint.profitUsd + saleGrossProfit).toFixed(2));
    }

    if (isToday) {
      todaySalesUsd += saleTotal;
      todayCogsUsd += saleCogs;
      const sPays = paymentsBySaleId.get(sale.id) || [];
      for (const p of sPays) {
        const amt = Number(p.amountUsd || 0);
        if (p.method === 'CASH') todayCashUsd += amt;
        else if (p.method === 'CREDIT') todayCreditUsd += amt;
        else todayMobileMoneyUsd += amt;
      }
    }
  }

  const todayExpensesUsd = scopedExpenses
    .filter((e) => isWithinToday(e.expenseDate))
    .reduce((sum, e) => sum + Number(e.amountUsd || 0), 0);

  const todayGrossProfitUsd = todaySalesUsd - todayCogsUsd;
  const todayNetProfitUsd = todayGrossProfitUsd - todayExpensesUsd;

  // Alerts: Low Stock & Expiry Buckets (30, 60, 90 days)
  let lowStockCount = 0;
  let expiredBatchesCount = 0;
  let expiring30Count = 0;
  let expiring60Count = 0;
  let expiring90Count = 0;

  for (const p of scopedProducts) {
    const pBatches = scopedBatches.filter((b) => b.productId === p.id);
    let sellable = 0;
    for (const b of pBatches) {
      const qty = Number(b.cachedQuantity || 0);
      if (qty <= 0) continue;
      const { bucket } = classifyExpiryBucket(String(b.expiryDate));
      if (bucket === 'EXPIRED') expiredBatchesCount++;
      else {
        sellable += qty;
        if (bucket === 'DAYS_30') expiring30Count++;
        else if (bucket === 'DAYS_60') expiring60Count++;
        else if (bucket === 'DAYS_90') expiring90Count++;
      }
    }
    if (sellable <= Number(p.reorderLevel || 10)) lowStockCount++;
  }

  const todayAppointmentsCount = scopedAppointments.filter((a) =>
    isWithinToday(a.scheduledAt)
  ).length;
  const openTasksCount = scopedTasks.filter(
    (tk) => tk.status === 'OPEN' || tk.status === 'IN_PROGRESS'
  ).length;

  // Admin Branch Comparison Cards (B1, B2, B3)
  const branchComparison = Object.values(BAXNAANO_BRANCHES).map((bDef) => {
    const bSales = allSales.filter(
      (s) =>
        (s.branchId === bDef.id || s.branchId === bDef.code) &&
        new Date(String(s.soldAt)).getTime() >= thirtyDaysAgoMs
    );
    const bExpenses = allExpenses.filter(
      (e) =>
        (e.branchId === bDef.id || e.branchId === bDef.code) &&
        new Date(String(e.expenseDate)).getTime() >= thirtyDaysAgoMs
    );

    let bTodaySales = 0;
    let bMonthSales = 0;
    let bMonthCogs = 0;

    for (const s of bSales) {
      const tot = Number(s.totalUsd || 0);
      bMonthSales += tot;
      if (isWithinToday(s.soldAt)) bTodaySales += tot;

      const items = saleItemsBySaleId.get(s.id) || [];
      for (const item of items) {
        const qty = Number(item.quantity || 0) - Number(item.refundedQuantity || 0);
        bMonthCogs += Math.max(0, qty) * Number(item.unitBuyPriceUsd || 0);
      }
    }

    const bMonthExpenses = bExpenses.reduce((sum, e) => sum + Number(e.amountUsd || 0), 0);
    const bMonthNetProfit = bMonthSales - bMonthCogs - bMonthExpenses;

    return {
      branchId: bDef.id,
      code: bDef.code,
      name: bDef.name,
      type: bDef.type,
      location: bDef.location,
      todaySalesUsd: Number(bTodaySales.toFixed(2)),
      monthSalesUsd: Number(bMonthSales.toFixed(2)),
      monthExpensesUsd: Number(bMonthExpenses.toFixed(2)),
      monthNetProfitUsd: Number(bMonthNetProfit.toFixed(2)),
    };
  });

  const trend30Days = Array.from(trendMap.values());
  const trend7Days = trend30Days.slice(-7);
  const topSellingItems = Array.from(topItemsMap.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 8);

  return {
    kpis: {
      todaySalesUsd: Number(todaySalesUsd.toFixed(2)),
      todayExpensesUsd: Number(todayExpensesUsd.toFixed(2)),
      todayGrossProfitUsd: Number(todayGrossProfitUsd.toFixed(2)),
      todayNetProfitUsd: Number(todayNetProfitUsd.toFixed(2)),
      todayCashUsd: Number(todayCashUsd.toFixed(2)),
      todayMobileMoneyUsd: Number(todayMobileMoneyUsd.toFixed(2)),
      todayCreditUsd: Number(todayCreditUsd.toFixed(2)),
    },
    alerts: {
      lowStockCount,
      expiredBatchesCount,
      expiring30Count,
      expiring60Count,
      expiring90Count,
      todayAppointmentsCount,
      openTasksCount,
    },
    trend7Days,
    trend30Days,
    topSellingItems,
    branchComparison,
  };
}

/**
 * Exports any tabular array to an Excel-compatible UTF-8 BOM CSV file offline
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

  // Prepend UTF-8 BOM so Microsoft Excel opens Somali/English characters cleanly
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

/**
 * Full Local IndexedDB Backup & Restore Utility (Settings Module)
 */
export async function exportFullOfflineDatabaseBackup(): Promise<void> {
  const backupPayload = {
    exportedAt: new Date().toISOString(),
    system: 'Baxnaano Pharmacy & Veterinary Clinic Management System',
    products: await db.products.toArray(),
    batches: await db.batches.toArray(),
    stockMovements: await db.stockMovements.toArray(),
    customers: await db.customers.toArray(),
    sales: await db.sales.toArray(),
    saleItems: await db.saleItems.toArray(),
    payments: await db.payments.toArray(),
    quotations: await db.quotations.toArray(),
    expenses: await db.expenses.toArray(),
    appointments: await db.appointments.toArray(),
    tasks: await db.tasks.toArray(),
    creditLedger: await db.creditLedger.toArray(),
  };

  const blob = new Blob([JSON.stringify(backupPayload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `baxnaano-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

export async function restoreFullOfflineDatabaseBackup(jsonText: string): Promise<void> {
  const parsed = JSON.parse(jsonText);
  await db.transaction(
    'rw',
    [
      db.products,
      db.batches,
      db.stockMovements,
      db.customers,
      db.sales,
      db.saleItems,
      db.payments,
      db.quotations,
      db.expenses,
      db.appointments,
      db.tasks,
      db.creditLedger,
    ],
    async () => {
      if (Array.isArray(parsed.products)) await db.products.bulkPut(parsed.products);
      if (Array.isArray(parsed.batches)) await db.batches.bulkPut(parsed.batches);
      if (Array.isArray(parsed.stockMovements))
        await db.stockMovements.bulkPut(parsed.stockMovements);
      if (Array.isArray(parsed.customers)) await db.customers.bulkPut(parsed.customers);
      if (Array.isArray(parsed.sales)) await db.sales.bulkPut(parsed.sales);
      if (Array.isArray(parsed.saleItems)) await db.saleItems.bulkPut(parsed.saleItems);
      if (Array.isArray(parsed.payments)) await db.payments.bulkPut(parsed.payments);
      if (Array.isArray(parsed.quotations)) await db.quotations.bulkPut(parsed.quotations);
      if (Array.isArray(parsed.expenses)) await db.expenses.bulkPut(parsed.expenses);
      if (Array.isArray(parsed.appointments))
        await db.appointments.bulkPut(parsed.appointments);
      if (Array.isArray(parsed.tasks)) await db.tasks.bulkPut(parsed.tasks);
      if (Array.isArray(parsed.creditLedger))
        await db.creditLedger.bulkPut(parsed.creditLedger);
    }
  );
}

export { getOfflineCustomersWithAging };

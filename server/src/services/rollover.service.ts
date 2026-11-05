import { prisma } from '../config/db';
import {
  addDaysToDateString,
  computePeriodSummaryKpis,
  getNextMogadishuMidnightUtc,
  mogadishuDayEndUtc,
  mogadishuDayStartUtc,
  toMogadishuDateString,
} from './financial.service';

let isRolloverRunning = false;
let lastVerifiedMogadishuDate: string | null = null;
let midnightTimer: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Ensures a specific business day (YYYY-MM-DD in Africa/Mogadishu) is closed and archived
 * for all active branches and consolidated enterprise level.
 * Idempotent: checks existing MIDNIGHT_ROLLOVER_CLOSE records before inserting, preventing duplicates.
 */
export async function closeBusinessDayIfNeeded(
  businessDate: string,
  triggeredBy: string = 'AUTO_MIDNIGHT_SCHEDULER'
): Promise<{ closedCount: number; alreadyClosedCount: number; businessDate: string }> {
  const startUtc = mogadishuDayStartUtc(businessDate);
  const endUtc = mogadishuDayEndUtc(businessDate);

  const branches = await prisma.branch.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { code: 'asc' },
  });

  const scopes: Array<{ branchId: string | null; branchCode: string }> = [
    { branchId: null, branchCode: 'ALL' },
    ...branches.map((b) => ({ branchId: b.id, branchCode: b.code })),
  ];

  let closedCount = 0;
  let alreadyClosedCount = 0;

  for (const scope of scopes) {
    const entityId = `CLOSE:${scope.branchCode}:${businessDate}`;
    const existing = await prisma.auditLog.findFirst({
      where: {
        action: 'MIDNIGHT_ROLLOVER_CLOSE',
        entityType: 'DailyFinancialClose',
        entityId,
      },
    });

    if (existing) {
      alreadyClosedCount++;
      continue;
    }

    const kpis = await computePeriodSummaryKpis(startUtc, endUtc, scope.branchId);

    await prisma.auditLog.create({
      data: {
        branchId: scope.branchId,
        userId: null,
        action: 'MIDNIGHT_ROLLOVER_CLOSE',
        entityType: 'DailyFinancialClose',
        entityId,
        reason: `Automated 12:00 AM Africa/Mogadishu Business Day Rollover (${businessDate})`,
        newData: {
          businessDate,
          branchId: scope.branchId,
          branchCode: scope.branchCode,
          closedBy: triggeredBy,
          closedAtIso: new Date().toISOString(),
          totalSalesUsd: kpis.totalSalesUsd,
          totalRevenueUsd: kpis.totalRevenueUsd,
          totalPurchasesUsd: kpis.totalPurchasesUsd,
          totalExpensesUsd: kpis.totalExpensesUsd,
          grossProfitUsd: kpis.grossProfitUsd,
          netProfitUsd: kpis.netProfitUsd,
          cashInflowUsd: kpis.cashInflowUsd,
          cashOutflowUsd: kpis.cashOutflowUsd,
          netCashFlowUsd: kpis.netCashFlowUsd,
          creditSalesUsd: kpis.creditSalesUsd,
          customerPaymentsUsd: kpis.customerPaymentsUsd,
          supplierPaymentsUsd: kpis.supplierPaymentsUsd,
          transactionCount: kpis.salesCount + kpis.purchasesCount,
        },
      },
    });

    closedCount++;
  }

  return { closedCount, alreadyClosedCount, businessDate };
}

/**
 * Checks if the business day in Africa/Mogadishu (UTC+3) has advanced or if any recent
 * past business days (up to 7 days back, handling server downtime) need to be closed.
 * Completely idempotent and mutex-guarded against concurrent runs.
 */
export async function ensureMidnightRolloverUpToDate(
  triggeredBy: string = 'AUTO_MIDNIGHT_SCHEDULER',
  forceRecheck: boolean = false
): Promise<{
  currentMogadishuDate: string;
  yesterdayMogadishuDate: string;
  closedDays: string[];
}> {
  const now = new Date();
  const todayStr = toMogadishuDateString(now);
  const yesterdayStr = addDaysToDateString(todayStr, -1);

  if (!forceRecheck && lastVerifiedMogadishuDate === todayStr) {
    return {
      currentMogadishuDate: todayStr,
      yesterdayMogadishuDate: yesterdayStr,
      closedDays: [],
    };
  }

  if (isRolloverRunning) {
    return {
      currentMogadishuDate: todayStr,
      yesterdayMogadishuDate: yesterdayStr,
      closedDays: [],
    };
  }

  isRolloverRunning = true;
  const closedDays: string[] = [];

  try {
    // Catch up up to 7 past days in chronological order in case of server downtime
    for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
      const targetDate = addDaysToDateString(todayStr, -daysAgo);
      const res = await closeBusinessDayIfNeeded(targetDate, triggeredBy);
      if (res.closedCount > 0) {
        closedDays.push(targetDate);
      }
    }
    lastVerifiedMogadishuDate = todayStr;
  } catch (err) {
    console.error('[Rollover] Error during midnight rollover check:', err);
  } finally {
    isRolloverRunning = false;
  }

  return {
    currentMogadishuDate: todayStr,
    yesterdayMogadishuDate: yesterdayStr,
    closedDays,
  };
}

/**
 * Schedules the exact 12:00 AM Africa/Mogadishu (UTC+3) rollover timer and 30-second resilience heartbeat.
 */
export function startMidnightRolloverScheduler(): void {
  // 1. Run immediate catch-up on server startup (handles server downtime)
  ensureMidnightRolloverUpToDate('STARTUP_DOWNTIME_CATCHUP', true).catch((err) => {
    console.warn('[Rollover] Startup check deferred:', err?.message || err);
  });

  // 2. Schedule exact timeout for next 12:00 AM Africa/Mogadishu
  const scheduleNextExactMidnight = () => {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const nextMidnight = getNextMogadishuMidnightUtc(now);
    const delayMs = Math.max(1000, nextMidnight.getTime() - now.getTime() + 250);

    midnightTimer = setTimeout(async () => {
      await ensureMidnightRolloverUpToDate('EXACT_MIDNIGHT_ROLLOVER', true);
      scheduleNextExactMidnight();
    }, delayMs);
  };

  scheduleNextExactMidnight();

  // 3. 30-second heartbeat to guarantee rollover even if system clock drifts or container sleeps
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    ensureMidnightRolloverUpToDate('HEARTBEAT_ROLLOVER_CHECK', false).catch(() => {});
  }, 30_000);
}


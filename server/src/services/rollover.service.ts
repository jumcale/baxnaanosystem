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
let startupDelayTimer: NodeJS.Timeout | null = null;

/**
 * Ensures a specific business day (YYYY-MM-DD in Africa/Mogadishu) is closed and archived
 * for all active branches and consolidated enterprise level.
 * Uses a single batch lookup for existing close records to avoid N+1 startup queries.
 */
export async function closeBusinessDayIfNeeded(
  businessDate: string,
  triggeredBy: string = 'AUTO_MIDNIGHT_SCHEDULER',
  preloadedBranches?: Array<{ id: string; code: string }>,
  existingCloseEntityIds?: Set<string>
): Promise<{ closedCount: number; alreadyClosedCount: number; businessDate: string }> {
  const branches =
    preloadedBranches ??
    (await prisma.branch.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    }));

  const scopes: Array<{ branchId: string | null; branchCode: string }> = [
    { branchId: null, branchCode: 'ALL' },
    ...branches.map((b) => ({ branchId: b.id, branchCode: b.code })),
  ];

  const entityIdsForDay = scopes.map((s) => `CLOSE:${s.branchCode}:${businessDate}`);

  let existingSet = existingCloseEntityIds;
  if (!existingSet) {
    const rows = await prisma.auditLog.findMany({
      where: {
        action: 'MIDNIGHT_ROLLOVER_CLOSE',
        entityType: 'DailyFinancialClose',
        entityId: { in: entityIdsForDay },
      },
      select: { entityId: true },
    });
    existingSet = new Set(rows.map((r) => r.entityId));
  }

  const missingScopes = scopes.filter(
    (s) => !existingSet!.has(`CLOSE:${s.branchCode}:${businessDate}`)
  );

  const alreadyClosedCount = scopes.length - missingScopes.length;
  if (missingScopes.length === 0) {
    return { closedCount: 0, alreadyClosedCount, businessDate };
  }

  const startUtc = mogadishuDayStartUtc(businessDate);
  const endUtc = mogadishuDayEndUtc(businessDate);
  let closedCount = 0;

  for (const scope of missingScopes) {
    const entityId = `CLOSE:${scope.branchCode}:${businessDate}`;
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
 * Completely idempotent, mutex-guarded, and uses a single batch query to verify all 7 days at once.
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
    const branches = await prisma.branch.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });

    const targetDates: string[] = [];
    const allEntityIds: string[] = [];
    const branchCodes = ['ALL', ...branches.map((b) => b.code)];

    for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
      const targetDate = addDaysToDateString(todayStr, -daysAgo);
      targetDates.push(targetDate);
      for (const code of branchCodes) {
        allEntityIds.push(`CLOSE:${code}:${targetDate}`);
      }
    }

    // Single fast indexed query checks all 28 close records at once
    const existingLogs = await prisma.auditLog.findMany({
      where: {
        action: 'MIDNIGHT_ROLLOVER_CLOSE',
        entityType: 'DailyFinancialClose',
        entityId: { in: allEntityIds },
      },
      select: { entityId: true },
    });
    const existingSet = new Set(existingLogs.map((r) => r.entityId));

    for (const targetDate of targetDates) {
      const res = await closeBusinessDayIfNeeded(
        targetDate,
        triggeredBy,
        branches,
        existingSet
      );
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
 * Schedules the exact 12:00 AM Africa/Mogadishu (UTC+3) rollover timer and resilience heartbeat.
 * Defers initial startup catch-up by 12 seconds so cold-start requests get 100% database priority.
 */
export function startMidnightRolloverScheduler(): void {
  if (startupDelayTimer) clearTimeout(startupDelayTimer);
  startupDelayTimer = setTimeout(() => {
    ensureMidnightRolloverUpToDate('STARTUP_DOWNTIME_CATCHUP', true).catch((err) => {
      console.warn('[Rollover] Startup check deferred:', err?.message || err);
    });
  }, 12_000);

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

  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    ensureMidnightRolloverUpToDate('HEARTBEAT_ROLLOVER_CHECK', false).catch(() => {});
  }, 60_000);
}

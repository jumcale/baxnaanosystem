import { Router, Request, Response } from 'express';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  classifyExpiryBucket,
  computeCustomerCreditAging,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';

export const reportsRouter = Router();

reportsRouter.use(authenticateJWT);

// ============================================================================
// 1. DASHBOARD SUMMARY (XOGTA GUUD) - BRANCH & ADMIN CONSOLIDATED VIEWS
// ============================================================================

reportsRouter.get(
  '/dashboard',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('dashboard:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thirtyDaysAgo = new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000);

      const branchWhere = scopedWhere(req);

      const [
        branches,
        recentSales,
        todayExpenses,
        productsWithBatches,
        todayAppointments,
        openTasksCount,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } }),
        prisma.sale.findMany({
          where: {
            ...branchWhere,
            status: 'COMPLETED',
            soldAt: { gte: thirtyDaysAgo },
          },
          include: {
            items: {
              include: {
                product: { select: { id: true, name: true, sku: true } },
              },
            },
            payments: true,
          },
        }),
        prisma.expense.findMany({
          where: {
            ...branchWhere,
            approvalStatus: 'APPROVED',
            expenseDate: { gte: startOfToday },
          },
        }),
        prisma.product.findMany({
          where: branchWhere,
          include: {
            batches: { where: { deletedAt: null } },
          },
        }),
        prisma.appointment.findMany({
          where: {
            ...branchWhere,
            scheduledAt: {
              gte: startOfToday,
              lte: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1),
            },
          },
          orderBy: { scheduledAt: 'asc' },
        }),
        prisma.task.count({
          where: {
            ...branchWhere,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          },
        }),
      ]);

      // 1. Today's Sales, COGS, Gross Profit, Expenses, Net Profit & Payment Split
      let todaySalesUsd = 0;
      let todayCogsUsd = 0;
      let todayCashUsd = 0;
      let todayMobileMoneyUsd = 0; // EVC_PLUS + ZAAD + EDAHAB
      let todayCreditUsd = 0;

      // 2. 30-day & 7-day Sales Trend Map
      const trendByDate = new Map<string, { date: string; salesUsd: number; profitUsd: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        trendByDate.set(key, { date: key, salesUsd: 0, profitUsd: 0 });
      }

      // 3. Top Selling Items (Last 30 Days)
      const topProductsMap = new Map<
        string,
        { productId: string; name: string; sku: string; quantitySold: number; revenueUsd: number }
      >();

      // 4. Admin Branch Comparison Map (B1, B2, B3)
      const branchComparisonMap = new Map<
        string,
        {
          branchId: string;
          code: string;
          name: string;
          type: string;
          location: string;
          todaySalesUsd: number;
          monthSalesUsd: number;
          monthProfitUsd: number;
        }
      >();

      for (const b of branches) {
        branchComparisonMap.set(b.id, {
          branchId: b.id,
          code: b.code,
          name: b.name,
          type: b.type,
          location: b.location,
          todaySalesUsd: 0,
          monthSalesUsd: 0,
          monthProfitUsd: 0,
        });
      }

      for (const sale of recentSales) {
        const saleTotal = Number(sale.totalUsd);
        const saleDateKey = sale.soldAt.toISOString().slice(0, 10);
        const isToday = sale.soldAt >= startOfToday;

        let saleCogs = 0;
        for (const item of sale.items) {
          const netQty = item.quantity - item.refundedQuantity;
          if (netQty <= 0) continue;
          saleCogs += netQty * Number(item.unitBuyPriceUsd);

          const existingProd = topProductsMap.get(item.productId) || {
            productId: item.productId,
            name: item.product.name,
            sku: item.product.sku,
            quantitySold: 0,
            revenueUsd: 0,
          };
          existingProd.quantitySold += netQty;
          existingProd.revenueUsd = Number(
            (existingProd.revenueUsd + Number(item.subtotalUsd)).toFixed(2)
          );
          topProductsMap.set(item.productId, existingProd);
        }

        const saleProfit = saleTotal - saleCogs;

        const trendPoint = trendByDate.get(saleDateKey);
        if (trendPoint) {
          trendPoint.salesUsd = Number((trendPoint.salesUsd + saleTotal).toFixed(2));
          trendPoint.profitUsd = Number((trendPoint.profitUsd + saleProfit).toFixed(2));
        }

        const bComp = branchComparisonMap.get(sale.branchId);
        if (bComp) {
          bComp.monthSalesUsd = Number((bComp.monthSalesUsd + saleTotal).toFixed(2));
          bComp.monthProfitUsd = Number((bComp.monthProfitUsd + saleProfit).toFixed(2));
          if (isToday) {
            bComp.todaySalesUsd = Number((bComp.todaySalesUsd + saleTotal).toFixed(2));
          }
        }

        if (isToday) {
          todaySalesUsd += saleTotal;
          todayCogsUsd += saleCogs;
          for (const pay of sale.payments) {
            const pAmt = Number(pay.amountUsd);
            if (pay.method === 'CASH') todayCashUsd += pAmt;
            else if (pay.method === 'CREDIT') todayCreditUsd += pAmt;
            else todayMobileMoneyUsd += pAmt;
          }
        }
      }

      const todayExpensesUsd = todayExpenses.reduce((s, e) => s + Number(e.amountUsd), 0);
      const todayGrossProfitUsd = todaySalesUsd - todayCogsUsd;
      const todayNetProfitUsd = todayGrossProfitUsd - todayExpensesUsd;

      // 5. Inventory Low Stock & Expiry Buckets (30, 60, 90 Days)
      let lowStockCount = 0;
      let expiredBatchesCount = 0;
      let expiring30Count = 0;
      let expiring60Count = 0;
      let expiring90Count = 0;

      for (const p of productsWithBatches) {
        let sellable = 0;
        for (const b of p.batches) {
          if (b.cachedQuantity <= 0) continue;
          const { bucket } = classifyExpiryBucket(b.expiryDate);
          if (bucket === 'EXPIRED') expiredBatchesCount++;
          else {
            sellable += b.cachedQuantity;
            if (bucket === 'DAYS_30') expiring30Count++;
            else if (bucket === 'DAYS_60') expiring60Count++;
            else if (bucket === 'DAYS_90') expiring90Count++;
          }
        }
        if (sellable <= p.reorderLevel) lowStockCount++;
      }

      const trend30Days = Array.from(trendByDate.values());
      const trend7Days = trend30Days.slice(-7);
      const topSellingItems = Array.from(topProductsMap.values())
        .sort((a, b) => b.quantitySold - a.quantitySold)
        .slice(0, 10);

      res.json({
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
          todayAppointmentsCount: todayAppointments.length,
          openTasksCount,
        },
        trend7Days,
        trend30Days,
        topSellingItems,
        todayAppointments,
        branchComparison:
          req.user?.role === 'ADMIN' ? Array.from(branchComparisonMap.values()) : [],
      });
    } catch (error) {
      console.error('[Reports] Dashboard error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 2. COMPREHENSIVE REPORTS (WARBIXINNADA) - DAILY/WEEKLY/MONTHLY P&L, VALUATION, STAFF
// ============================================================================

reportsRouter.get(
  '/comprehensive',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('reports:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const period = (req.query.period as string) || 'MONTHLY'; // DAILY, WEEKLY, MONTHLY
      const now = new Date();
      const daysBack = period === 'DAILY' ? 1 : period === 'WEEKLY' ? 7 : 30;
      const fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

      const branchWhere = scopedWhere(req);

      const [sales, expenses, products, customers, appointments] = await Promise.all([
        prisma.sale.findMany({
          where: { ...branchWhere, status: 'COMPLETED', soldAt: { gte: fromDate } },
          include: {
            cashier: { select: { id: true, fullName: true } },
            items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          },
        }),
        prisma.expense.findMany({
          where: { ...branchWhere, approvalStatus: 'APPROVED', expenseDate: { gte: fromDate } },
        }),
        prisma.product.findMany({
          where: branchWhere,
          include: { batches: { where: { deletedAt: null } } },
        }),
        prisma.customer.findMany({
          where: branchWhere,
          include: { creditEntries: { where: { deletedAt: null } } },
        }),
        prisma.appointment.findMany({
          where: { ...branchWhere, scheduledAt: { gte: fromDate } },
        }),
      ]);

      // 1. Profit & Loss
      let revenueUsd = 0;
      let cogsUsd = 0;
      const staffSalesMap = new Map<
        string,
        { userId: string; fullName: string; salesCount: number; totalRevenueUsd: number }
      >();
      const productVelocityMap = new Map<string, number>();

      for (const s of sales) {
        const rev = Number(s.totalUsd);
        revenueUsd += rev;

        for (const item of s.items) {
          const netQty = item.quantity - item.refundedQuantity;
          cogsUsd += netQty * Number(item.unitBuyPriceUsd);
          productVelocityMap.set(
            item.productId,
            (productVelocityMap.get(item.productId) || 0) + netQty
          );
        }

        const stf = staffSalesMap.get(s.cashierId) || {
          userId: s.cashierId,
          fullName: s.cashier.fullName,
          salesCount: 0,
          totalRevenueUsd: 0,
        };
        stf.salesCount++;
        stf.totalRevenueUsd = Number((stf.totalRevenueUsd + rev).toFixed(2));
        staffSalesMap.set(s.cashierId, stf);
      }

      const expensesUsd = expenses.reduce((sum, e) => sum + Number(e.amountUsd), 0);
      const grossProfitUsd = revenueUsd - cogsUsd;
      const netProfitUsd = grossProfitUsd - expensesUsd;

      // 2. Stock Valuation & Fast vs Slow Movers
      let totalStockCostValuationUsd = 0;
      let totalStockRetailValuationUsd = 0;

      const movers = products.map((p) => {
        const stockQty = p.batches.reduce((sum, b) => sum + Math.max(0, b.cachedQuantity), 0);
        const costVal = p.batches.reduce(
          (sum, b) => sum + Math.max(0, b.cachedQuantity) * Number(b.buyPriceUsd),
          0
        );
        const retailVal = p.batches.reduce(
          (sum, b) => sum + Math.max(0, b.cachedQuantity) * Number(b.sellPriceUsd),
          0
        );
        totalStockCostValuationUsd += costVal;
        totalStockRetailValuationUsd += retailVal;

        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          stockQty,
          quantitySoldInPeriod: productVelocityMap.get(p.id) || 0,
          costValuationUsd: Number(costVal.toFixed(2)),
        };
      });

      const fastMovers = [...movers]
        .sort((a, b) => b.quantitySoldInPeriod - a.quantitySoldInPeriod)
        .slice(0, 10);
      const slowMovers = [...movers]
        .filter((m) => m.stockQty > 0)
        .sort((a, b) => a.quantitySoldInPeriod - b.quantitySoldInPeriod)
        .slice(0, 10);

      // 3. Credit Aging Summary
      const creditAgingTotals = {
        totalDueUsd: 0,
        bucket0to30Usd: 0,
        bucket31to60Usd: 0,
        bucket60PlusUsd: 0,
      };
      for (const c of customers) {
        const ag = computeCustomerCreditAging(
          c.creditEntries.map((e) => ({
            id: e.id,
            type: e.type,
            amountDeltaUsd: Number(e.amountDeltaUsd),
            createdAt: e.createdAt,
            dueDate: e.dueDate,
          }))
        );
        creditAgingTotals.totalDueUsd += ag.totalBalanceUsd;
        creditAgingTotals.bucket0to30Usd += ag.bucket0to30Usd;
        creditAgingTotals.bucket31to60Usd += ag.bucket31to60Usd;
        creditAgingTotals.bucket60PlusUsd += ag.bucket60PlusUsd;
      }

      res.json({
        period,
        profitAndLoss: {
          revenueUsd: Number(revenueUsd.toFixed(2)),
          cogsUsd: Number(cogsUsd.toFixed(2)),
          grossProfitUsd: Number(grossProfitUsd.toFixed(2)),
          expensesUsd: Number(expensesUsd.toFixed(2)),
          netProfitUsd: Number(netProfitUsd.toFixed(2)),
        },
        stockValuation: {
          totalCostValuationUsd: Number(totalStockCostValuationUsd.toFixed(2)),
          totalRetailValuationUsd: Number(totalStockRetailValuationUsd.toFixed(2)),
          projectedMarginUsd: Number(
            (totalStockRetailValuationUsd - totalStockCostValuationUsd).toFixed(2)
          ),
        },
        fastMovers,
        slowMovers,
        creditAgingTotals,
        appointmentsSummary: {
          total: appointments.length,
          done: appointments.filter((a) => a.status === 'DONE').length,
          booked: appointments.filter((a) => a.status === 'BOOKED').length,
          cancelledOrNoShow: appointments.filter(
            (a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW'
          ).length,
        },
        staffPerformance: Array.from(staffSalesMap.values()).sort(
          (a, b) => b.totalRevenueUsd - a.totalRevenueUsd
        ),
      });
    } catch (error) {
      console.error('[Reports] Comprehensive report error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 3. SETTINGS (DEJINTA): BRANCH PROFILE, RATE/TAX, USERS, AUDIT LOG, BACKUP
// ============================================================================

reportsRouter.patch(
  '/settings/branch/:id',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('settings:manage'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const branchId = req.params.id;
      if (req.user!.role !== 'ADMIN' && req.user!.branchId !== branchId) {
        res.status(403).json({ error: 'CROSS_BRANCH_ACCESS_DENIED' });
        return;
      }

      const {
        name,
        phone,
        address,
        exchangeRate,
        taxRate,
        receiptHeader,
        receiptFooter,
        defaultLang,
      } = req.body;

      const updated = await prisma.branch.update({
        where: { id: branchId },
        data: {
          ...(name ? { name } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(address !== undefined ? { address } : {}),
          ...(exchangeRate !== undefined ? { exchangeRate: Number(exchangeRate) } : {}),
          ...(taxRate !== undefined ? { taxRate: Number(taxRate) } : {}),
          ...(receiptHeader !== undefined ? { receiptHeader } : {}),
          ...(receiptFooter !== undefined ? { receiptFooter } : {}),
          ...(defaultLang ? { defaultLang } : {}),
          version: { increment: 1 },
        },
      });

      await recordAuditLog({
        branchId,
        userId: req.user!.id,
        action: 'BRANCH_SETTINGS_UPDATE',
        entityType: 'Branch',
        entityId: branchId,
        newData: { exchangeRate: updated.exchangeRate, taxRate: updated.taxRate },
        ipAddress: req.ip,
      });

      res.json({ branch: updated });
    } catch (error) {
      console.error('[Settings] Update branch error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

reportsRouter.get(
  '/settings/audit-logs',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('audit:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.min(200, Number(req.query.limit) || 100);
      const logs = await prisma.auditLog.findMany({
        where: req.branchScope?.branchId ? { branchId: req.branchScope.branchId } : {},
        include: {
          user: { select: { id: true, fullName: true, username: true } },
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      res.json({ auditLogs: logs });
    } catch (error) {
      console.error('[Settings] Audit logs error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

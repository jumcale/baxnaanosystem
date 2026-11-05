import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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
  DashboardAnalyticsResponseSchema,
  normalizePaymentToUsd,
  CurrencyType,
} from '@baxnaano/shared';
import { recordAuditLog } from '../utils/audit';
import {
  addDaysToDateString,
  computePeriodSummaryKpis,
  computeSingleSaleFinancials,
  d,
  generateFullFinancialReport,
  mogadishuDayEndUtc,
  mogadishuDayStartUtc,
  round2,
  toMogadishuDateString,
} from '../services/financial.service';
import { ensureMidnightRolloverUpToDate } from '../services/rollover.service';

export const reportsRouter = Router();

reportsRouter.use(authenticateJWT);

// ============================================================================
// 1. DASHBOARD SUMMARY (XOGTA GUUD) - AFRICA/MOGADISHU (UTC+3) & DECIMAL ACCURATE
// ============================================================================

reportsRouter.get(
  '/dashboard',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('dashboard:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Ensure midnight rollover for Africa/Mogadishu (UTC+3) has processed
      await ensureMidnightRolloverUpToDate('DASHBOARD_QUERY_CHECK', false);

      const now = new Date();
      const todayMogStr = toMogadishuDateString(now);
      const startOfToday = mogadishuDayStartUtc(todayMogStr);
      const endOfToday = mogadishuDayEndUtc(todayMogStr);
      const thirtyDaysAgoStr = addDaysToDateString(todayMogStr, -29);
      const thirtyDaysAgo = mogadishuDayStartUtc(thirtyDaysAgoStr);
      const monthStartStr = `${todayMogStr.slice(0, 7)}-01`;
      const startOfMonth = mogadishuDayStartUtc(monthStartStr);

      const branchWhere = scopedWhere(req);
      const activeBranchId = req.branchScope?.branchId || undefined;

      const [
        branches,
        recentSales,
        monthExpenses,
        productsWithBatches,
        todayAppointments,
        openTasksCount,
        todayPeriodKpis,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } }),
        prisma.sale.findMany({
          where: {
            ...branchWhere,
            status: { not: 'VOIDED' },
            soldAt: { gte: thirtyDaysAgo <= startOfMonth ? thirtyDaysAgo : startOfMonth },
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
            expenseDate: { gte: startOfMonth },
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
              lte: endOfToday,
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
        computePeriodSummaryKpis(startOfToday, endOfToday, activeBranchId),
      ]);

      // 30-day & 7-day Sales Trend Map in Africa/Mogadishu dates
      const trendByDate = new Map<string, { date: string; salesUsd: number; profitUsd: number }>();
      for (let i = 29; i >= 0; i--) {
        const key = addDaysToDateString(todayMogStr, -i);
        trendByDate.set(key, { date: key, salesUsd: 0, profitUsd: 0 });
      }

      // Top Selling Items (Last 30 Days)
      const topProductsMap = new Map<
        string,
        { productId: string; name: string; sku: string; quantitySold: number; revenueUsd: number }
      >();

      // Admin Branch Comparison Map (B1, B2, B3)
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
          monthNetProfitUsd: number;
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
          monthNetProfitUsd: 0,
        });
      }

      for (const sale of recentSales) {
        const calc = computeSingleSaleFinancials(sale);
        if (calc.isVoided) continue;

        const saleDateKey = toMogadishuDateString(sale.soldAt);
        const isToday = saleDateKey === todayMogStr;
        const isThisMonth = sale.soldAt >= startOfMonth;
        const isLast30Days = sale.soldAt >= thirtyDaysAgo;

        if (isLast30Days) {
          for (const item of sale.items) {
            const netQty = item.quantity - item.refundedQuantity;
            if (netQty <= 0) continue;

            const existingProd = topProductsMap.get(item.productId) || {
              productId: item.productId,
              name: item.product.name,
              sku: item.product.sku,
              quantitySold: 0,
              revenueUsd: 0,
            };
            existingProd.quantitySold += netQty;
            existingProd.revenueUsd = round2(
              d(existingProd.revenueUsd).plus(d(item.subtotalUsd))
            );
            topProductsMap.set(item.productId, existingProd);
          }

          const trendPoint = trendByDate.get(saleDateKey);
          if (trendPoint) {
            trendPoint.salesUsd = round2(d(trendPoint.salesUsd).plus(calc.netRevenueUsd));
            trendPoint.profitUsd = round2(d(trendPoint.profitUsd).plus(calc.grossProfitUsd));
          }
        }

        const bComp = branchComparisonMap.get(sale.branchId);
        if (bComp) {
          if (isThisMonth) {
            bComp.monthSalesUsd = round2(d(bComp.monthSalesUsd).plus(calc.netRevenueUsd));
            bComp.monthProfitUsd = round2(d(bComp.monthProfitUsd).plus(calc.grossProfitUsd));
          }
          if (isToday) {
            bComp.todaySalesUsd = round2(d(bComp.todaySalesUsd).plus(calc.netRevenueUsd));
          }
        }
      }

      // Deduct approved monthly expenses per branch for monthNetProfitUsd
      const branchMonthExpMap = new Map<string, Prisma.Decimal>();
      for (const exp of monthExpenses) {
        const prev = branchMonthExpMap.get(exp.branchId) || d(0);
        branchMonthExpMap.set(exp.branchId, prev.plus(d(exp.amountUsd)));
      }
      for (const bComp of branchComparisonMap.values()) {
        const bExp = branchMonthExpMap.get(bComp.branchId) || d(0);
        bComp.monthNetProfitUsd = round2(d(bComp.monthProfitUsd).minus(bExp));
      }

      // Inventory Low Stock & Expiry Buckets (30, 60, 90 Days)
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

      const todayMobileMoneyUsd = round2(
        d(todayPeriodKpis.cashByMethod.EVC_PLUS)
          .plus(d(todayPeriodKpis.cashByMethod.ZAAD))
          .plus(d(todayPeriodKpis.cashByMethod.EDAHAB))
      );

      const payload = {
        kpis: {
          todaySalesUsd: todayPeriodKpis.totalRevenueUsd,
          todayRevenueUsd: todayPeriodKpis.totalRevenueUsd,
          todayExpensesUsd: todayPeriodKpis.totalExpensesUsd,
          todayGrossProfitUsd: todayPeriodKpis.grossProfitUsd,
          todayNetProfitUsd: todayPeriodKpis.netProfitUsd,
          todayCashUsd: todayPeriodKpis.cashByMethod.CASH,
          todayMobileMoneyUsd,
          todayCreditUsd: todayPeriodKpis.creditSalesUsd,
          todayPurchasesUsd: todayPeriodKpis.totalPurchasesUsd,
          todayCustomerPaymentsUsd: todayPeriodKpis.customerPaymentsUsd,
          todaySupplierPaymentsUsd: todayPeriodKpis.supplierPaymentsUsd,
          todayRefundsUsd: todayPeriodKpis.refundsUsd,
          todayCashFlowUsd: todayPeriodKpis.netCashFlowUsd,
          cashBalanceUsd: todayPeriodKpis.cashBalanceUsd,
          outstandingReceivablesUsd: todayPeriodKpis.outstandingReceivablesUsd,
          outstandingPayablesUsd: todayPeriodKpis.outstandingPayablesUsd,
          businessDateMogadishu: todayMogStr,
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
      };

      if (process.env.NODE_ENV !== 'production') {
        const validated = DashboardAnalyticsResponseSchema.safeParse(payload);
        if (!validated.success) {
          console.error('[Dashboard Contract Drift]:', validated.error.flatten());
        }
      }

      res.json(payload);
    } catch (error) {
      console.error('[Reports] Dashboard error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 2. COMPLETE FINANCIAL REPORTING ENGINE (ALL MODULES, FILTERS & ROLLOVER)
// ============================================================================

reportsRouter.get(
  '/financial',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('reports:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await ensureMidnightRolloverUpToDate('FINANCIAL_REPORT_QUERY', false);

      const q = req.query as Record<string, string | undefined>;
      const effectiveBranchId =
        req.user?.role === 'ADMIN'
          ? req.branchScope?.branchId || q.branchId || 'ALL'
          : req.user?.branchId || req.branchScope?.branchId || 'ALL';

      const report = await generateFullFinancialReport({
        preset: q.preset || q.period || 'THIS_MONTH',
        fromDate: q.fromDate,
        toDate: q.toDate,
        branchId: effectiveBranchId,
        transactionType: q.transactionType || 'ALL',
        paymentMethod: q.paymentMethod || 'ALL',
        employeeId: q.employeeId || 'ALL',
        status: q.status || 'ALL',
        search: q.search || '',
      });

      res.json(report);
    } catch (error) {
      console.error('[Reports] Full financial report error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// Legacy /comprehensive endpoint upgraded to use the centralized Financial Service
reportsRouter.get(
  '/comprehensive',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('reports:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      await ensureMidnightRolloverUpToDate('COMPREHENSIVE_REPORT_QUERY', false);

      const period = ((req.query.period as string) || 'MONTHLY').toUpperCase();
      const effectiveBranchId = req.branchScope?.branchId || 'ALL';

      const report = await generateFullFinancialReport({
        preset: period,
        branchId: effectiveBranchId,
      });

      const appointments = await prisma.appointment.findMany({
        where: scopedWhere(req),
      });

      res.json({
        period: period === 'TODAY' ? 'DAILY' : period === 'THIS_WEEK' ? 'WEEKLY' : period === 'THIS_MONTH' ? 'MONTHLY' : period,
        profitAndLoss: {
          revenueUsd: report.kpis.totalRevenueUsd,
          cogsUsd: report.kpis.cogsUsd,
          grossProfitUsd: report.kpis.grossProfitUsd,
          expensesUsd: report.kpis.totalExpensesUsd,
          netProfitUsd: report.kpis.netProfitUsd,
        },
        stockValuation: {
          totalCostValuationUsd: report.stockValuation.totalCostValuationUsd,
          totalRetailValuationUsd: report.stockValuation.totalRetailValuationUsd,
          projectedMarginUsd: report.stockValuation.projectedMarginUsd,
        },
        fastMovers: report.fastMovers,
        slowMovers: report.slowMovers,
        creditAgingTotals: report.creditAgingTotals,
        appointmentsSummary: {
          total: appointments.length,
          done: appointments.filter((a) => a.status === 'DONE').length,
          booked: appointments.filter((a) => a.status === 'BOOKED').length,
          cancelledOrNoShow: appointments.filter(
            (a) => a.status === 'CANCELLED' || a.status === 'NO_SHOW'
          ).length,
        },
        staffPerformance: report.staffPerformance.map((s) => ({
          staffId: s.employeeId,
          userId: s.employeeId,
          name: s.fullName,
          fullName: s.fullName,
          transactionCount: s.salesCount,
          salesCount: s.salesCount,
          totalRevenueUsd: s.netRevenueUsd,
        })),
      });
    } catch (error) {
      console.error('[Reports] Comprehensive report error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 3. SUPPLIER PAYMENTS (ACCOUNTS PAYABLE SETTLEMENT) & ROLLOVER VERIFICATION
// ============================================================================

reportsRouter.post(
  '/supplier-payments',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        supplierId,
        amountOriginal,
        currency = 'USD',
        exchangeRateUsed = 8500,
        paymentMethod = 'CASH',
        referenceNumber,
        notes,
      } = req.body || {};

      if (!supplierId || !amountOriginal || Number(amountOriginal) <= 0) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Valid supplierId and positive payment amount are required.',
        });
        return;
      }

      const amountPaidUsd = normalizePaymentToUsd(
        Number(amountOriginal),
        currency as CurrencyType,
        Number(exchangeRateUsed || 8500)
      );

      const result = await prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.findFirst({
          where: { id: supplierId, deletedAt: null },
          include: {
            purchases: {
              where: { deletedAt: null },
              orderBy: { purchaseDate: 'asc' },
            },
          },
        });

        if (!supplier) {
          throw new Error('SUPPLIER_NOT_FOUND');
        }

        if (req.user!.role !== 'ADMIN' && req.user!.branchId !== supplier.branchId) {
          throw new Error('CROSS_BRANCH_ACCESS_DENIED');
        }

        const currentBal = d(supplier.balanceUsd);
        const newBal = Prisma.Decimal.max(d(0), currentBal.minus(d(amountPaidUsd)));

        const updatedSupplier = await tx.supplier.update({
          where: { id: supplier.id },
          data: {
            balanceUsd: newBal,
            version: { increment: 1 },
          },
        });

        // Apply payment FIFO to oldest unpaid purchases
        let remainingToApply = d(amountPaidUsd);
        for (const pur of supplier.purchases) {
          if (remainingToApply.lte(0)) break;
          const unpaid = d(pur.totalAmountUsd).minus(d(pur.paidAmountUsd));
          if (unpaid.lte(0)) continue;
          const applyNow = Prisma.Decimal.min(unpaid, remainingToApply);
          await tx.purchase.update({
            where: { id: pur.id },
            data: {
              paidAmountUsd: d(pur.paidAmountUsd).plus(applyNow),
              version: { increment: 1 },
            },
          });
          remainingToApply = remainingToApply.minus(applyNow);
        }

        const refNo =
          referenceNumber ||
          `SUP-PAY-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
            100 + Math.random() * 900
          )}`;

        const auditEntry = await tx.auditLog.create({
          data: {
            branchId: supplier.branchId,
            userId: req.user!.id,
            action: 'SUPPLIER_PAYMENT',
            entityType: 'Supplier',
            entityId: supplier.id,
            reason: notes || `Supplier payment to ${supplier.name} via ${paymentMethod}`,
            oldData: { balanceUsd: round2(currentBal) },
            newData: {
              supplierId: supplier.id,
              supplierName: supplier.name,
              amountPaidUsd: round2(d(amountPaidUsd)),
              currency,
              amountOriginal: Number(amountOriginal),
              paymentMethod,
              referenceNumber: refNo,
              balanceAfterUsd: round2(newBal),
            },
            ipAddress: req.ip,
          },
        });

        return { supplier: updatedSupplier, paymentRecord: auditEntry };
      });

      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'SUPPLIER_PAYMENT_ERROR';
      if (msg === 'SUPPLIER_NOT_FOUND') {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === 'CROSS_BRANCH_ACCESS_DENIED') {
        res.status(403).json({ error: msg });
        return;
      }
      console.error('[Reports] Supplier payment error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

reportsRouter.post(
  '/rollover/verify',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('reports:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await ensureMidnightRolloverUpToDate(
        req.user?.username || 'MANUAL_VERIFICATION',
        true
      );
      res.json({
        success: true,
        timezone: 'Africa/Mogadishu',
        ...result,
      });
    } catch (error) {
      console.error('[Reports] Rollover verify error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 4. SETTINGS (DEJINTA): BRANCH PROFILE, RATE/TAX, USERS, AUDIT LOG
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

      if (req.body.exchangeRate !== undefined && req.user!.role !== 'ADMIN') {
        res.status(403).json({
          error: 'FORBIDDEN_EXCHANGE_RATE_UPDATE',
          message: 'Only administrator can change currency exchange rates.',
        });
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

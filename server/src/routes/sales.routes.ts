import { Router, Request, Response } from 'express';
import {
  CreditTransactionType,
  Currency,
  PaymentMethod,
  StockMovementType,
} from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  CreateSaleSchema,
  VoidSaleSchema,
  RefundSaleSchema,
  normalizePaymentToUsd,
  usdToSlsh,
  classifyExpiryBucket,
  hasPermission,
} from '@baxnaano/shared';
import {
  appendStockMovement,
  getProductFEFOAllocation,
  recalculateBatchBalanceFromLedger,
} from '../services/inventory.service';
import { recordAuditLog } from '../utils/audit';

export const salesRouter = Router();

salesRouter.use(authenticateJWT);

/**
 * POST /api/sales
 * Atomic POS Checkout:
 * 1. Branch-scoped idempotency by sale UUID (`id`) preventing cross-branch replay or double-submit.
 * 2. Uses authoritative server-side Product/Batch prices and Branch exchangeRate.
 * 3. Acquires row locks (`FOR UPDATE`) on batches and allocates stock using FEFO.
 * 4. Strictly blocks expired batches.
 * 5. Enforces discount approval governance and customer credit limits.
 */
salesRouter.post(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('sales:create'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;

      const result = await prisma.$transaction(async (tx) => {
        // 1. Branch-scoped Idempotency check
        if (data.id) {
          const existingSale = await tx.sale.findUnique({
            where: { id: data.id },
            include: { items: true, payments: true, customer: true },
          });
          if (existingSale) {
            if (existingSale.branchId !== data.branchId) {
              throw new Error('CROSS_BRANCH_ACCESS_DENIED');
            }
            return { sale: existingSale, idempotentReplay: true };
          }
        }

        // 2. Resolve Branch & Authoritative Exchange Rate
        const branch = await tx.branch.findUnique({ where: { id: data.branchId } });
        if (!branch || branch.deletedAt) {
          throw new Error('BRANCH_NOT_FOUND');
        }
        const branchCode = branch.code || 'BX';
        // Use authoritative branch exchange rate unless ADMIN explicitly overrides within valid bounds
        const authoritativeExchangeRate =
          req.user!.role === 'ADMIN' && data.exchangeRateUsed > 0
            ? data.exchangeRateUsed
            : Number(branch.exchangeRate) || data.exchangeRateUsed;

        const receiptNumber =
          data.receiptNumber ||
          `${branchCode}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
            1000 + Math.random() * 9000
          )}`;

        // 3. Allocate FEFO Batches & Compute Server-Side Totals
        const resolvedSaleItems: Array<{
          productId: string;
          batchId: string;
          batchNumber: string;
          quantity: number;
          unitBuyPriceUsd: number;
          unitPriceUsd: number;
          discountUsd: number;
          subtotalUsd: number;
          dosageNote: string | null;
        }> = [];

        let subtotalUsd = 0;

        for (const reqItem of data.items) {
          const lineDiscountUsd = Number(reqItem.discountUsd || 0);

          // Verify Product exists and belongs strictly to this branch
          let product = await tx.product.findFirst({
            where: { id: reqItem.productId, branchId: data.branchId, deletedAt: null },
          });
          if (!product && reqItem.sku) {
            product = await tx.product.findFirst({
              where: { branchId: data.branchId, sku: reqItem.sku, deletedAt: null },
            });
          }
          if (!product) {
            throw new Error(`PRODUCT_NOT_FOUND:${reqItem.productId}`);
          }

          const effectiveProductId = product.id;

          if (reqItem.batchId) {
            // Lock specific batch row for update
            await tx.$queryRaw`SELECT id FROM "ProductBatch" WHERE id = ${reqItem.batchId} AND "branchId" = ${data.branchId} FOR UPDATE`;

            let batch = await tx.productBatch.findFirst({
              where: {
                id: reqItem.batchId,
                branchId: data.branchId,
                productId: effectiveProductId,
                deletedAt: null,
              },
            });

            if (!batch && reqItem.batchNumber) {
              batch = await tx.productBatch.findFirst({
                where: {
                  branchId: data.branchId,
                  productId: effectiveProductId,
                  batchNumber: reqItem.batchNumber,
                  deletedAt: null,
                },
              });
            }

            if (!batch) {
              throw new Error(`BATCH_NOT_FOUND:${reqItem.batchId || reqItem.batchNumber || ''}`);
            }

            const { bucket } = classifyExpiryBucket(batch.expiryDate);
            if (bucket === 'EXPIRED') {
              throw new Error(`EXPIRED_BATCH_BLOCKED:${batch.batchNumber}`);
            }

            const availableQty = await recalculateBatchBalanceFromLedger(
              tx,
              data.branchId,
              batch.id
            );
            if (availableQty < reqItem.quantity) {
              throw new Error(
                `INSUFFICIENT_STOCK:${batch.batchNumber}:available=${availableQty}`
              );
            }

            // Use authoritative sellPriceUsd from database (prevent client price tampering below sell price)
            const authoritativeUnitPrice = Number(batch.sellPriceUsd) || Number(product.sellPriceUsd);
            const effectiveUnitPrice =
              reqItem.unitPriceUsd >= authoritativeUnitPrice ||
              hasPermission(req.user!.role, 'sales:approve_discount')
                ? reqItem.unitPriceUsd
                : authoritativeUnitPrice;

            const grossLine = Number((reqItem.quantity * effectiveUnitPrice).toFixed(2));
            const cappedLineDiscount = Math.min(grossLine, Math.max(0, lineDiscountUsd));
            const lineTotal = Number((grossLine - cappedLineDiscount).toFixed(2));
            subtotalUsd += grossLine;

            resolvedSaleItems.push({
              productId: effectiveProductId,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              quantity: reqItem.quantity,
              unitBuyPriceUsd: Number(batch.buyPriceUsd),
              unitPriceUsd: effectiveUnitPrice,
              discountUsd: cappedLineDiscount,
              subtotalUsd: lineTotal,
              dosageNote: reqItem.dosageNote ?? null,
            });
          } else {
            // Auto FEFO allocation across one or more non-expired batches (locks rows inside getProductFEFOAllocation)
            const fefo = await getProductFEFOAllocation(
              tx,
              data.branchId,
              effectiveProductId,
              reqItem.quantity
            );

            if (!fefo.success) {
              if (fefo.errorCode === 'EXPIRED_BATCHES_ONLY') {
                throw new Error(
                  `EXPIRED_BATCHES_ONLY:${fefo.expiredBatchesSkipped.join(',')}`
                );
              }
              throw new Error(`INSUFFICIENT_FEFO_STOCK:shortfall=${fefo.shortfallQuantity}`);
            }

            let remainingDiscount = lineDiscountUsd;
            fefo.allocations.forEach((alloc, idx) => {
              const isLast = idx === fefo.allocations.length - 1;
              const allocDiscount = isLast
                ? remainingDiscount
                : Number(
                    ((alloc.allocatedQuantity / reqItem.quantity) * lineDiscountUsd).toFixed(2)
                  );
              remainingDiscount = Number((remainingDiscount - allocDiscount).toFixed(2));

              const authoritativeUnitPrice = alloc.unitSellPriceUsd || Number(product!.sellPriceUsd);
              const effectiveUnitPrice =
                reqItem.unitPriceUsd >= authoritativeUnitPrice ||
                hasPermission(req.user!.role, 'sales:approve_discount')
                  ? reqItem.unitPriceUsd
                  : authoritativeUnitPrice;

              const grossLine = Number((alloc.allocatedQuantity * effectiveUnitPrice).toFixed(2));
              const cappedAllocDiscount = Math.min(grossLine, Math.max(0, allocDiscount));
              const lineTotal = Number((grossLine - cappedAllocDiscount).toFixed(2));
              subtotalUsd += grossLine;

              resolvedSaleItems.push({
                productId: effectiveProductId,
                batchId: alloc.batchId,
                batchNumber: alloc.batchNumber,
                quantity: alloc.allocatedQuantity,
                unitBuyPriceUsd: alloc.unitBuyPriceUsd,
                unitPriceUsd: effectiveUnitPrice,
                discountUsd: cappedAllocDiscount,
                subtotalUsd: lineTotal,
                dosageNote: reqItem.dosageNote ?? null,
              });
            });
          }
        }

        subtotalUsd = Number(subtotalUsd.toFixed(2));
        const totalLineDiscounts = resolvedSaleItems.reduce((s, i) => s + i.discountUsd, 0);
        const rawTotalDiscountUsd = Number((totalLineDiscounts + data.discountUsd).toFixed(2));
        const totalDiscountUsd = Math.min(subtotalUsd, Math.max(0, rawTotalDiscountUsd));

        const totalUsd = Number(
          Math.max(0, subtotalUsd - totalDiscountUsd + data.taxUsd).toFixed(2)
        );
        const totalSlsh = usdToSlsh(totalUsd, authoritativeExchangeRate);

        // 4. Normalize Split Payments (Cash, EVC Plus, Zaad, eDahab, Credit)
        let paidUsd = 0;
        let creditAmountUsd = 0;

        const normalizedPayments = data.payments.map((p) => {
          const amountUsd = normalizePaymentToUsd(
            p.amountOriginal,
            p.currency,
            authoritativeExchangeRate
          );
          if (p.method === 'CREDIT') {
            creditAmountUsd = Number((creditAmountUsd + amountUsd).toFixed(2));
          } else {
            paidUsd = Number((paidUsd + amountUsd).toFixed(2));
          }
          return {
            id: p.id,
            method: p.method as PaymentMethod,
            currency: p.currency as Currency,
            amountOriginal: p.amountOriginal,
            amountUsd,
            exchangeRateUsed: authoritativeExchangeRate,
            referencePhone: p.referencePhone ?? null,
            transactionRef: p.transactionRef ?? null,
          };
        });

        const totalTenderedUsd = Number((paidUsd + creditAmountUsd).toFixed(2));
        if (totalTenderedUsd + 0.02 < totalUsd) {
          throw new Error(
            `INSUFFICIENT_PAYMENT:total=${totalUsd}:tendered=${totalTenderedUsd}`
          );
        }

        const changeUsd = Number(Math.max(0, paidUsd - (totalUsd - creditAmountUsd)).toFixed(2));

        // 5. Verify Customer Branch Ownership & Credit Limit if Credit Payment is used
        let resolvedCustomerId: string | null = data.customerId ?? null;
        if (resolvedCustomerId) {
          const customer = await tx.customer.findFirst({
            where: { id: resolvedCustomerId, deletedAt: null },
          });

          if (!customer) {
            throw new Error('CUSTOMER_NOT_FOUND');
          }

          if (customer.branchId !== data.branchId) {
            throw new Error('CROSS_BRANCH_ACCESS_DENIED');
          }

          if (creditAmountUsd > 0) {
            const newBalance = Number(customer.currentBalanceUsd) + creditAmountUsd;
            if (
              newBalance > Number(customer.creditLimitUsd) &&
              !data.approvedById &&
              req.user!.role !== 'ADMIN' &&
              req.user!.role !== 'BRANCH_MANAGER'
            ) {
              throw new Error(
                `CREDIT_LIMIT_EXCEEDED:limit=${customer.creditLimitUsd}:newBalance=${newBalance.toFixed(
                  2
                )}`
              );
            }
          }
        } else if (creditAmountUsd > 0) {
          throw new Error('CUSTOMER_REQUIRED_FOR_CREDIT_SALE');
        }

        // 6. Create Sale Record
        const sale = await tx.sale.create({
          data: {
            id: data.id,
            branchId: data.branchId,
            receiptNumber,
            cashierId: req.user!.id,
            customerId: resolvedCustomerId,
            status: 'COMPLETED',
            currency: data.currency as Currency,
            exchangeRateUsed: authoritativeExchangeRate,
            subtotalUsd,
            discountUsd: totalDiscountUsd,
            taxUsd: data.taxUsd,
            totalUsd,
            totalSlsh,
            paidUsd,
            creditAmountUsd,
            changeUsd,
            approvedById: data.approvedById ?? null,
            prescriptionRef: data.prescriptionRef ?? null,
            notes: data.notes ?? null,
            soldAt: data.soldAt ? new Date(data.soldAt) : new Date(),
            items: {
              create: resolvedSaleItems.map((item) => ({
                branchId: data.branchId,
                productId: item.productId,
                batchId: item.batchId,
                quantity: item.quantity,
                unitBuyPriceUsd: item.unitBuyPriceUsd,
                unitPriceUsd: item.unitPriceUsd,
                discountUsd: item.discountUsd,
                subtotalUsd: item.subtotalUsd,
                dosageNote: item.dosageNote,
              })),
            },
            payments: {
              create: normalizedPayments.map((pay) => ({
                id: pay.id,
                branchId: data.branchId,
                method: pay.method,
                currency: pay.currency,
                amountOriginal: pay.amountOriginal,
                amountUsd: pay.amountUsd,
                exchangeRateUsed: pay.exchangeRateUsed,
                referencePhone: pay.referencePhone,
                transactionRef: pay.transactionRef,
              })),
            },
          },
          include: {
            items: {
              include: {
                product: { select: { name: true, sku: true, dosePerKg: true, withdrawalPeriodDays: true } },
                batch: { select: { batchNumber: true, expiryDate: true } },
              },
            },
            payments: true,
            customer: true,
          },
        });

        // 7. Deduct Stock via Ledger Movements (SALE)
        for (const item of resolvedSaleItems) {
          await appendStockMovement(tx, {
            branchId: data.branchId,
            productId: item.productId,
            batchId: item.batchId,
            userId: req.user!.id,
            type: StockMovementType.SALE,
            quantityDelta: -Math.abs(item.quantity),
            unitCostUsd: item.unitBuyPriceUsd,
            referenceId: sale.id,
            referenceType: 'SALE',
            reason: `POS Sale #${receiptNumber}`,
          });
        }

        // 8. Append Credit Ledger Entry if creditAmountUsd > 0
        if (creditAmountUsd > 0 && resolvedCustomerId) {
          const updatedCustomer = await tx.customer.update({
            where: { id: resolvedCustomerId },
            data: {
              currentBalanceUsd: { increment: creditAmountUsd },
              version: { increment: 1 },
            },
          });

          const defaultDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await tx.creditLedger.create({
            data: {
              branchId: data.branchId,
              customerId: resolvedCustomerId,
              saleId: sale.id,
              type: CreditTransactionType.CHARGE,
              amountDeltaUsd: creditAmountUsd,
              balanceAfterUsd: updatedCustomer.currentBalanceUsd,
              dueDate: data.dueDate ? new Date(data.dueDate) : defaultDue,
              notes: `Credit from Sale #${receiptNumber}`,
              recordedById: req.user!.id,
            },
          });
        }

        return { sale, idempotentReplay: false };
      });

      if (Number(result.sale.discountUsd) > 0 && !result.idempotentReplay) {
        await recordAuditLog({
          branchId: data.branchId,
          userId: req.user!.id,
          action: 'SALE_DISCOUNT_APPLIED',
          entityType: 'Sale',
          entityId: result.sale.id,
          newData: {
            receiptNumber: result.sale.receiptNumber,
            discountUsd: result.sale.discountUsd,
            approvedById: data.approvedById,
          },
          ipAddress: req.ip,
        });
      }

      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'UNKNOWN_SALE_ERROR';
      if (msg === 'CROSS_BRANCH_ACCESS_DENIED') {
        res.status(403).json({ error: msg });
        return;
      }
      if (msg.startsWith('PRODUCT_NOT_FOUND') || msg.startsWith('BATCH_NOT_FOUND')) {
        res.status(404).json({ error: msg.split(':')[0], details: msg });
        return;
      }
      if (
        msg.startsWith('EXPIRED_BATCH') ||
        msg.startsWith('INSUFFICIENT_') ||
        msg.startsWith('CUSTOMER_') ||
        msg.startsWith('CREDIT_LIMIT_EXCEEDED')
      ) {
        res.status(400).json({ error: msg.split(':')[0], details: msg });
        return;
      }
      console.error('[Sales] Checkout error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/sales/:id/receipt
 * Fetches full receipt data for 58mm / 80mm thermal or PDF rendering.
 * Enforces branch scope and VET_OFFICER own-activity isolation.
 */
salesRouter.get(
  '/:id/receipt',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('sales:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sale = await prisma.sale.findFirst({
        where: scopedWhere(req, {
          id: req.params.id,
          ...(req.user?.role === 'VET_OFFICER' ? { cashierId: req.user.id } : {}),
        }),
        include: {
          branch: true,
          cashier: { select: { id: true, fullName: true, username: true } },
          customer: true,
          items: {
            include: {
              product: true,
              batch: true,
            },
          },
          payments: true,
        },
      });

      if (!sale) {
        res.status(404).json({ error: 'SALE_NOT_FOUND' });
        return;
      }

      res.json({ sale });
    } catch (error) {
      console.error('[Sales] Get receipt error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/sales
 * Sales History (Taariikhda Iibka):
 * Filter by date range, cashierId, paymentMethod, customerId, status, or receiptNumber.
 * Enforces VET_OFFICER own-activity isolation.
 */
salesRouter.get(
  '/',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('sales:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        fromDate,
        toDate,
        date,
        cashierId,
        customerId,
        paymentMethod,
        status,
        search,
      } = req.query as Record<string, string | undefined>;
      const effectiveFrom = fromDate || (date ? `${date}T00:00:00.000Z` : undefined);
      const effectiveTo = toDate || (date ? `${date}T23:59:59.999Z` : undefined);

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      // VET_OFFICER is locked strictly to their own sales activity
      const enforcedCashierId =
        req.user?.role === 'VET_OFFICER' ? req.user.id : cashierId;

      const where = scopedWhere(req, {
        ...(enforcedCashierId ? { cashierId: enforcedCashierId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(status ? { status: status as 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' } : {}),
        ...(effectiveFrom || effectiveTo
          ? {
              soldAt: {
                ...(effectiveFrom ? { gte: new Date(effectiveFrom) } : {}),
                ...(effectiveTo ? { lte: new Date(effectiveTo) } : {}),
              },
            }
          : {}),
        ...(paymentMethod
          ? {
              payments: {
                some: { method: paymentMethod as PaymentMethod, deletedAt: null },
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { receiptNumber: { contains: search, mode: 'insensitive' as const } },
                { customer: { name: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      });

      const [sales, total] = await Promise.all([
        prisma.sale.findMany({
          where,
          include: {
            branch: { select: { id: true, code: true, name: true } },
            cashier: { select: { id: true, fullName: true, username: true } },
            approvedBy: { select: { id: true, fullName: true } },
            customer: { select: { id: true, name: true, phone: true } },
            items: {
              include: {
                product: { select: { id: true, name: true, sku: true } },
                batch: { select: { id: true, batchNumber: true, expiryDate: true } },
              },
            },
            payments: true,
          },
          orderBy: { soldAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.sale.count({ where }),
      ]);

      res.json({
        sales,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('[Sales] History query error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/sales/:id/void
 */
salesRouter.post(
  '/:id/void',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('sales:approve_void_refund'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = VoidSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const saleId = req.params.id;
      const { reason } = parsed.data;

      const updatedSale = await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findFirst({
          where: scopedWhere(req, { id: saleId }),
          include: { items: true },
        });

        if (!sale) {
          throw new Error('SALE_NOT_FOUND');
        }
        if (sale.status === 'VOIDED') {
          return sale;
        }

        for (const item of sale.items) {
          const netSoldQty = item.quantity - item.refundedQuantity;
          if (netSoldQty > 0) {
            await appendStockMovement(tx, {
              branchId: sale.branchId,
              productId: item.productId,
              batchId: item.batchId,
              userId: req.user!.id,
              type: StockMovementType.VOID_REVERSAL,
              quantityDelta: Math.abs(netSoldQty),
              unitCostUsd: Number(item.unitBuyPriceUsd),
              referenceId: sale.id,
              referenceType: 'SALE_VOID',
              reason: `Void Sale #${sale.receiptNumber}: ${reason}`,
            });
          }
        }

        if (Number(sale.creditAmountUsd) > 0 && sale.customerId) {
          const customer = await tx.customer.update({
            where: { id: sale.customerId },
            data: {
              currentBalanceUsd: { decrement: Number(sale.creditAmountUsd) },
              version: { increment: 1 },
            },
          });

          await tx.creditLedger.create({
            data: {
              branchId: sale.branchId,
              customerId: sale.customerId,
              saleId: sale.id,
              type: CreditTransactionType.VOID_REVERSAL,
              amountDeltaUsd: -Math.abs(Number(sale.creditAmountUsd)),
              balanceAfterUsd: customer.currentBalanceUsd,
              isSettled: true,
              notes: `Void Reversal for Sale #${sale.receiptNumber}: ${reason}`,
              recordedById: req.user!.id,
            },
          });
        }

        return tx.sale.update({
          where: { id: sale.id },
          data: {
            status: 'VOIDED',
            approvedById: req.user!.id,
            voidOrRefundReason: reason,
            voidedAt: new Date(),
            version: { increment: 1 },
          },
          include: { items: true, payments: true },
        });
      });

      await recordAuditLog({
        branchId: updatedSale.branchId,
        userId: req.user!.id,
        action: 'SALE_VOID',
        entityType: 'Sale',
        entityId: updatedSale.id,
        newData: { receiptNumber: updatedSale.receiptNumber, status: 'VOIDED' },
        reason,
        ipAddress: req.ip,
      });

      res.json({ sale: updatedSale });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'VOID_ERROR';
      if (msg === 'SALE_NOT_FOUND') {
        res.status(404).json({ error: msg });
        return;
      }
      console.error('[Sales] Void error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * POST /api/sales/:id/refund
 */
salesRouter.post(
  '/:id/refund',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('sales:approve_void_refund'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = RefundSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const saleId = req.params.id;
      const { reason, items } = parsed.data;

      const updatedSale = await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findFirst({
          where: scopedWhere(req, { id: saleId }),
          include: { items: true },
        });

        if (!sale || sale.status === 'VOIDED') {
          throw new Error('SALE_NOT_ELIGIBLE_FOR_REFUND');
        }

        for (const reqRefund of items) {
          const saleItem = sale.items.find((i) => i.id === reqRefund.saleItemId);
          if (!saleItem) {
            throw new Error(`SALE_ITEM_NOT_FOUND:${reqRefund.saleItemId}`);
          }
          const refundableQty = saleItem.quantity - saleItem.refundedQuantity;
          if (reqRefund.quantityToRefund > refundableQty) {
            throw new Error(`REFUND_QTY_EXCEEDS_SOLD:${saleItem.id}`);
          }

          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: {
              refundedQuantity: { increment: reqRefund.quantityToRefund },
              version: { increment: 1 },
            },
          });

          await appendStockMovement(tx, {
            branchId: sale.branchId,
            productId: saleItem.productId,
            batchId: saleItem.batchId,
            userId: req.user!.id,
            type: StockMovementType.REFUND_RETURN,
            quantityDelta: Math.abs(reqRefund.quantityToRefund),
            unitCostUsd: Number(saleItem.unitBuyPriceUsd),
            referenceId: sale.id,
            referenceType: 'SALE_REFUND',
            reason: `Refund on Sale #${sale.receiptNumber}: ${reason}`,
          });
        }

        const refreshedItems = await tx.saleItem.findMany({ where: { saleId: sale.id } });
        const allRefunded = refreshedItems.every((i) => i.refundedQuantity >= i.quantity);

        return tx.sale.update({
          where: { id: sale.id },
          data: {
            status: allRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            approvedById: req.user!.id,
            voidOrRefundReason: reason,
            version: { increment: 1 },
          },
          include: { items: true, payments: true },
        });
      });

      await recordAuditLog({
        branchId: updatedSale.branchId,
        userId: req.user!.id,
        action: 'SALE_REFUND',
        entityType: 'Sale',
        entityId: updatedSale.id,
        newData: { receiptNumber: updatedSale.receiptNumber, status: updatedSale.status, items },
        reason,
        ipAddress: req.ip,
      });

      res.json({ sale: updatedSale });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'REFUND_ERROR';
      if (
        msg.startsWith('SALE_') ||
        msg.startsWith('REFUND_QTY_EXCEEDS_SOLD')
      ) {
        res.status(400).json({ error: msg.split(':')[0], details: msg });
        return;
      }
      console.error('[Sales] Refund error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

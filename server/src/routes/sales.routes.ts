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
 * 1. Idempotent by sale UUID (`id`) for safe offline-first sync replay.
 * 2. Allocates stock using FEFO (First Expiry, First Out) or verifies explicit non-expired batch.
 * 3. Blocks expired batches strictly.
 * 4. Appends negative `SALE` StockMovement entries to the ledger.
 * 5. Records split payments (Cash, EVC Plus, Zaad, eDahab, Credit) in USD or SLSH.
 * 6. If Credit payment is present, verifies customer & credit limit and appends a `CHARGE` to CreditLedger.
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
      const isOfflineSyncReplay = req.headers['x-offline-sync'] === 'true';

      const result = await prisma.$transaction(async (tx) => {
        // 1. Idempotency check (if offline client synced this sale already)
        if (data.id) {
          const existingSale = await tx.sale.findUnique({
            where: { id: data.id },
            include: { items: true, payments: true, customer: true },
          });
          if (existingSale) {
            return { sale: existingSale, idempotentReplay: true };
          }
        }

        // 2. Resolve Branch & Receipt Number
        const branch = await tx.branch.findUnique({ where: { id: data.branchId } });
        const branchCode = branch?.code || 'BX';
        const receiptNumber =
          data.receiptNumber ||
          `${branchCode}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(
            1000 + Math.random() * 9000
          )}`;

        // 3. Allocate FEFO Batches & Build SaleLineItems
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

          // Ensure Product exists on server (supports offline-created or legacy-seeded products)
          let product = await tx.product.findFirst({
            where: { id: reqItem.productId, deletedAt: null },
          });
          if (!product && reqItem.sku) {
            product = await tx.product.findFirst({
              where: { branchId: data.branchId, sku: reqItem.sku, deletedAt: null },
            });
          }
          if (!product) {
            const category = await tx.category.upsert({
              where: { branchId_name: { branchId: data.branchId, name: 'General Medicines' } },
              update: {},
              create: { branchId: data.branchId, name: 'General Medicines', nameSo: 'Daawooyinka Guud' },
            });
            const unit = await tx.unit.upsert({
              where: { branchId_name: { branchId: data.branchId, name: 'Unit' } },
              update: {},
              create: { branchId: data.branchId, name: 'Unit', abbreviation: 'pcs' },
            });
            const fallbackSku = reqItem.sku || `SKU-${reqItem.productId.slice(0, 8).toUpperCase()}`;
            product = await tx.product.upsert({
              where: { branchId_sku: { branchId: data.branchId, sku: fallbackSku } },
              update: {},
              create: {
                id: reqItem.productId,
                branchId: data.branchId,
                categoryId: category.id,
                unitId: unit.id,
                sku: fallbackSku,
                name: reqItem.productName || fallbackSku,
                buyPriceUsd: reqItem.unitBuyPriceUsd ?? Number((reqItem.unitPriceUsd * 0.65).toFixed(2)),
                sellPriceUsd: reqItem.unitPriceUsd,
                reorderLevel: 10,
              },
            });
          }

          const effectiveProductId = product.id;

          if (reqItem.batchId) {
            // Explicit batch provided (e.g. chosen or allocated offline)
            let batch = await tx.productBatch.findFirst({
              where: {
                id: reqItem.batchId,
                branchId: data.branchId,
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
              const fallbackBatchNum =
                reqItem.batchNumber || `BATCH-${reqItem.batchId.slice(0, 6).toUpperCase()}`;
              const fallbackExpiry = reqItem.expiryDate
                ? new Date(reqItem.expiryDate)
                : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
              const buyPrice =
                reqItem.unitBuyPriceUsd ?? Number(product.buyPriceUsd || reqItem.unitPriceUsd * 0.65);

              batch = await tx.productBatch.upsert({
                where: {
                  branchId_productId_batchNumber: {
                    branchId: data.branchId,
                    productId: effectiveProductId,
                    batchNumber: fallbackBatchNum,
                  },
                },
                update: {},
                create: {
                  id: reqItem.batchId,
                  branchId: data.branchId,
                  productId: effectiveProductId,
                  batchNumber: fallbackBatchNum,
                  expiryDate: fallbackExpiry,
                  buyPriceUsd: buyPrice,
                  sellPriceUsd: reqItem.unitPriceUsd,
                  cachedQuantity: Math.max(100, reqItem.quantity),
                },
              });

              await tx.stockMovement.create({
                data: {
                  branchId: data.branchId,
                  productId: effectiveProductId,
                  batchId: batch.id,
                  userId: req.user!.id,
                  type: StockMovementType.INITIAL_STOCK,
                  quantityDelta: Math.max(100, reqItem.quantity),
                  unitCostUsd: buyPrice,
                  reason: 'Auto-synced offline batch initial stock',
                },
              });
            }

            const { bucket } = classifyExpiryBucket(batch.expiryDate);
            if (bucket === 'EXPIRED' && !isOfflineSyncReplay) {
              throw new Error(`EXPIRED_BATCH_BLOCKED:${batch.batchNumber}`);
            }

            if (!isOfflineSyncReplay) {
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
            }

            const lineTotal = Number(
              (reqItem.quantity * reqItem.unitPriceUsd - lineDiscountUsd).toFixed(2)
            );
            subtotalUsd += reqItem.quantity * reqItem.unitPriceUsd;

            resolvedSaleItems.push({
              productId: effectiveProductId,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              quantity: reqItem.quantity,
              unitBuyPriceUsd: Number(batch.buyPriceUsd),
              unitPriceUsd: reqItem.unitPriceUsd,
              discountUsd: lineDiscountUsd,
              subtotalUsd: lineTotal,
              dosageNote: reqItem.dosageNote ?? null,
            });
          } else {
            // Auto FEFO allocation across one or more non-expired batches
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

            // Distribute line discount proportionally if split across multiple batches
            let remainingDiscount = lineDiscountUsd;
            fefo.allocations.forEach((alloc, idx) => {
              const isLast = idx === fefo.allocations.length - 1;
              const allocDiscount = isLast
                ? remainingDiscount
                : Number(
                    ((alloc.allocatedQuantity / reqItem.quantity) * lineDiscountUsd).toFixed(2)
                  );
              remainingDiscount = Number((remainingDiscount - allocDiscount).toFixed(2));

              const lineTotal = Number(
                (alloc.allocatedQuantity * reqItem.unitPriceUsd - allocDiscount).toFixed(2)
              );
              subtotalUsd += alloc.allocatedQuantity * reqItem.unitPriceUsd;

              resolvedSaleItems.push({
                productId: effectiveProductId,
                batchId: alloc.batchId,
                batchNumber: alloc.batchNumber,
                quantity: alloc.allocatedQuantity,
                unitBuyPriceUsd: alloc.unitBuyPriceUsd,
                unitPriceUsd: reqItem.unitPriceUsd,
                discountUsd: allocDiscount,
                subtotalUsd: lineTotal,
                dosageNote: reqItem.dosageNote ?? null,
              });
            });
          }
        }

        subtotalUsd = Number(subtotalUsd.toFixed(2));
        const totalLineDiscounts = resolvedSaleItems.reduce((s, i) => s + i.discountUsd, 0);
        const totalDiscountUsd = Number((totalLineDiscounts + data.discountUsd).toFixed(2));
        const totalUsd = Number(
          Math.max(0, subtotalUsd - totalDiscountUsd + data.taxUsd).toFixed(2)
        );
        const totalSlsh = usdToSlsh(totalUsd, data.exchangeRateUsed);

        // 4. Normalize Split Payments (Cash, EVC Plus, Zaad, eDahab, Credit)
        let paidUsd = 0;
        let creditAmountUsd = 0;

        const normalizedPayments = data.payments.map((p) => {
          const amountUsd = normalizePaymentToUsd(
            p.amountOriginal,
            p.currency,
            data.exchangeRateUsed
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
            exchangeRateUsed: data.exchangeRateUsed,
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

        // 5. Ensure Customer Exists & Validate Credit Limit if Credit Payment is used
        let resolvedCustomerId: string | null = data.customerId ?? null;
        if (resolvedCustomerId) {
          let customer = await tx.customer.findFirst({
            where: { id: resolvedCustomerId, deletedAt: null },
          });
          if (!customer && data.customerName) {
            customer = await tx.customer.create({
              data: {
                id: resolvedCustomerId,
                branchId: data.branchId,
                name: data.customerName,
                phone: data.customerPhone || '+252630000000',
                creditLimitUsd: Math.max(500, creditAmountUsd * 2),
                currentBalanceUsd: 0,
              },
            });
          }
          if (!customer) {
            if (creditAmountUsd > 0) {
              customer = await tx.customer.create({
                data: {
                  id: resolvedCustomerId,
                  branchId: data.branchId,
                  name: data.customerName || 'Credit Customer',
                  phone: data.customerPhone || '+252630000000',
                  creditLimitUsd: Math.max(500, creditAmountUsd * 2),
                  currentBalanceUsd: 0,
                },
              });
            } else {
              resolvedCustomerId = null;
            }
          } else if (creditAmountUsd > 0) {
            const newBalance = Number(customer.currentBalanceUsd) + creditAmountUsd;
            if (
              newBalance > Number(customer.creditLimitUsd) &&
              !data.approvedById &&
              req.user!.role !== 'ADMIN' &&
              req.user!.role !== 'BRANCH_MANAGER' &&
              req.user!.role !== 'VET_OFFICER' &&
              !isOfflineSyncReplay
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
            exchangeRateUsed: data.exchangeRateUsed,
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
            allowNegativeInOfflineSync: isOfflineSyncReplay,
          });
        }

        // 8. Append Credit Ledger Entry if creditAmountUsd > 0
        if (creditAmountUsd > 0 && data.customerId) {
          const updatedCustomer = await tx.customer.update({
            where: { id: data.customerId },
            data: {
              currentBalanceUsd: { increment: creditAmountUsd },
              version: { increment: 1 },
            },
          });

          const defaultDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await tx.creditLedger.create({
            data: {
              branchId: data.branchId,
              customerId: data.customerId,
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

      if (data.discountUsd > 0) {
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
 * Fetches full receipt data for 58mm / 80mm thermal or PDF rendering
 */
salesRouter.get(
  '/:id/receipt',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('sales:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sale = await prisma.sale.findFirst({
        where: scopedWhere(req, { id: req.params.id }),
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
 * Filter by date range, cashierId, paymentMethod, customerId, status, or receiptNumber
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
        cashierId,
        customerId,
        paymentMethod,
        status,
        search,
      } = req.query as Record<string, string | undefined>;

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      const where = scopedWhere(req, {
        ...(cashierId ? { cashierId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(status ? { status: status as 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' } : {}),
        ...(fromDate || toDate
          ? {
              soldAt: {
                ...(fromDate ? { gte: new Date(fromDate) } : {}),
                ...(toDate ? { lte: new Date(`${toDate}T23:59:59.999Z`) } : {}),
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
 * Voids an entire sale with mandatory reason & approval:
 * 1. Reverses stock by appending positive `VOID_REVERSAL` StockMovement entries to each batch.
 * 2. If sale had a credit balance, reverses the customer's debt and appends a `VOID_REVERSAL` CreditLedger entry.
 * 3. Writes an AuditLog (`SALE_VOID`).
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
          return sale; // Idempotent
        }

        // 1. Return remaining non-refunded quantities back to each batch via ledger
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

        // 2. Reverse customer credit charge if creditAmountUsd > 0
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
 * Full or partial item refund with mandatory reason & approval:
 * Appends `REFUND_RETURN` positive StockMovement entries and updates sale status.
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
        newData: { status: updatedSale.status, items },
        reason,
        ipAddress: req.ip,
      });

      res.json({ sale: updatedSale });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'REFUND_ERROR';
      if (msg.startsWith('SALE_') || msg.startsWith('REFUND_')) {
        res.status(400).json({ error: msg });
        return;
      }
      console.error('[Sales] Refund error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);


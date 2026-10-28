import { Router, Request, Response } from 'express';
import {
  AppointmentStatus,
  ApprovalStatus,
  CreditTransactionType,
  Currency,
  PaymentMethod,
  QuotationStatus,
  Species,
  StockMovementType,
  TaskPriority,
  TaskStatus,
  TransferStatus,
  VisitType,
} from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  scopedWhere,
} from '../middleware/auth';
import {
  appendStockMovement,
  recalculateBatchBalanceFromLedger,
} from '../services/inventory.service';

export const syncRouter = Router();

syncRouter.use(authenticateJWT);

interface IncomingSyncItem {
  id: string;
  branchId: string;
  entityType: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'LEDGER_APPEND';
  payload: Record<string, unknown>;
  baseVersion: number;
  createdAt: string;
}

/**
 * Helper to ensure a branch has a valid Category and Unit so offline-created Products
 * never fail foreign-key constraints on sync.
 */
async function ensureBranchCategoryAndUnit(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  branchId: string
): Promise<{ categoryId: string; unitId: string }> {
  const category = await tx.category.upsert({
    where: { branchId_name: { branchId, name: 'General Medicines' } },
    update: {},
    create: {
      branchId,
      name: 'General Medicines',
      nameSo: 'Daawooyinka Guud',
    },
  });

  const unit = await tx.unit.upsert({
    where: { branchId_name: { branchId, name: 'Unit' } },
    update: {},
    create: {
      branchId,
      name: 'Unit',
      abbreviation: 'pcs',
    },
  });

  return { categoryId: category.id, unitId: unit.id };
}

/**
 * POST /api/sync/push
 * Processes a batch of offline SyncQueue items from the client:
 * - Server is the source of truth.
 * - Stock is NEVER overwritten; StockMovements are appended idempotently by UUID,
 *   and ProductBatch.cachedQuantity is recalculated as SUM(quantityDelta).
 * - Other entities use Last-Write-Wins (LWW) with version increment and idempotency by UUID.
 */
syncRouter.post(
  '/push',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const items = (req.body.items || []) as IncomingSyncItem[];
      const deviceId = String(req.body.deviceId || 'pwa-client');

      const results: Array<{
        queueId: string;
        entityId: string;
        status: 'COMPLETED' | 'CONFLICT' | 'FAILED';
        errorMessage?: string;
      }> = [];

      for (const item of items) {
        if (
          req.user!.role !== 'ADMIN' &&
          item.branchId !== req.user!.branchId
        ) {
          results.push({
            queueId: item.id,
            entityId: item.entityId,
            status: 'FAILED',
            errorMessage: 'CROSS_BRANCH_SYNC_DENIED',
          });
          continue;
        }

        try {
          await prisma.$transaction(async (tx) => {
            const p = item.payload || {};

            switch (item.entityType) {
              case 'StockMovement': {
                const prodId = String(p.productId);
                const batchId = String(p.batchId);
                const existingBatch = await tx.productBatch.findUnique({ where: { id: batchId } });
                if (existingBatch) {
                  await appendStockMovement(tx, {
                    id: String(p.id || item.entityId),
                    branchId: item.branchId,
                    productId: existingBatch.productId,
                    batchId: existingBatch.id,
                    userId: req.user!.id,
                    type: (p.type as StockMovementType) || StockMovementType.ADJUSTMENT_MINUS,
                    quantityDelta: Number(p.quantityDelta),
                    unitCostUsd: p.unitCostUsd !== undefined ? Number(p.unitCostUsd) : undefined,
                    referenceId: p.referenceId ? String(p.referenceId) : undefined,
                    referenceType: p.referenceType ? String(p.referenceType) : 'OFFLINE_SYNC',
                    reason: p.reason ? String(p.reason) : 'Synced offline stock movement',
                    allowNegativeInOfflineSync: true,
                  });
                } else {
                  const existingProd = await tx.product.findUnique({ where: { id: prodId } });
                  if (existingProd) {
                    const fallbackBatch = await tx.productBatch.create({
                      data: {
                        id: batchId,
                        branchId: item.branchId,
                        productId: existingProd.id,
                        batchNumber: `BATCH-${batchId.slice(0, 6).toUpperCase()}`,
                        expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
                        buyPriceUsd: existingProd.buyPriceUsd,
                        sellPriceUsd: existingProd.sellPriceUsd,
                        cachedQuantity: 0,
                      },
                    });
                    await appendStockMovement(tx, {
                      id: String(p.id || item.entityId),
                      branchId: item.branchId,
                      productId: existingProd.id,
                      batchId: fallbackBatch.id,
                      userId: req.user!.id,
                      type: (p.type as StockMovementType) || StockMovementType.ADJUSTMENT_MINUS,
                      quantityDelta: Number(p.quantityDelta),
                      unitCostUsd: p.unitCostUsd !== undefined ? Number(p.unitCostUsd) : undefined,
                      referenceId: p.referenceId ? String(p.referenceId) : undefined,
                      referenceType: p.referenceType ? String(p.referenceType) : 'OFFLINE_SYNC',
                      reason: p.reason ? String(p.reason) : 'Synced offline stock movement',
                      allowNegativeInOfflineSync: true,
                    });
                  }
                }
                break;
              }

              case 'Product': {
                const { categoryId, unitId } = await ensureBranchCategoryAndUnit(
                  tx,
                  item.branchId
                );
                const sku = String(p.sku || `SKU-${item.entityId.slice(0, 8).toUpperCase()}`);
                const existingBySku = await tx.product.findUnique({
                  where: { branchId_sku: { branchId: item.branchId, sku } },
                });

                const targetId = existingBySku ? existingBySku.id : item.entityId;

                await tx.product.upsert({
                  where: { id: targetId },
                  update: {
                    name: String(p.name),
                    barcode: p.barcode ? String(p.barcode) : null,
                    buyPriceUsd: Number(p.buyPriceUsd || 0),
                    sellPriceUsd: Number(p.sellPriceUsd || 0),
                    reorderLevel: Number(p.reorderLevel || 10),
                    genericName: p.genericName ? String(p.genericName) : null,
                    dosageForm: p.dosageForm ? String(p.dosageForm) : null,
                    strength: p.strength ? String(p.strength) : null,
                    isPrescriptionOnly: Boolean(p.isPrescriptionOnly),
                    targetSpecies: (Array.isArray(p.targetSpecies)
                      ? p.targetSpecies
                      : []) as Species[],
                    dosePerKg: p.dosePerKg ? String(p.dosePerKg) : null,
                    withdrawalPeriodDays: p.withdrawalPeriodDays
                      ? Number(p.withdrawalPeriodDays)
                      : null,
                    isColdChainRequired: Boolean(p.isColdChainRequired),
                    version: { increment: 1 },
                  },
                  create: {
                    id: targetId,
                    branchId: item.branchId,
                    categoryId,
                    unitId,
                    sku,
                    barcode: p.barcode ? String(p.barcode) : null,
                    name: String(p.name),
                    buyPriceUsd: Number(p.buyPriceUsd || 0),
                    sellPriceUsd: Number(p.sellPriceUsd || 0),
                    reorderLevel: Number(p.reorderLevel || 10),
                    genericName: p.genericName ? String(p.genericName) : null,
                    dosageForm: p.dosageForm ? String(p.dosageForm) : null,
                    strength: p.strength ? String(p.strength) : null,
                    isPrescriptionOnly: Boolean(p.isPrescriptionOnly),
                    targetSpecies: (Array.isArray(p.targetSpecies)
                      ? p.targetSpecies
                      : []) as Species[],
                    dosePerKg: p.dosePerKg ? String(p.dosePerKg) : null,
                    withdrawalPeriodDays: p.withdrawalPeriodDays
                      ? Number(p.withdrawalPeriodDays)
                      : null,
                    isColdChainRequired: Boolean(p.isColdChainRequired),
                  },
                });
                break;
              }

              case 'Purchase': {
                let supplier = await tx.supplier.findFirst({
                  where: { branchId: item.branchId, deletedAt: null },
                });
                if (!supplier) {
                  supplier = await tx.supplier.create({
                    data: {
                      branchId: item.branchId,
                      name: 'General Medical Supplier',
                      phone: '+252634400000',
                    },
                  });
                }

                const purchaseItems = Array.isArray(p.items)
                  ? (p.items as Array<Record<string, unknown>>)
                  : [];

                let totalAmountUsd = 0;
                for (const pi of purchaseItems) {
                  const qty = Math.max(1, Number(pi.quantity || 1));
                  const buyPrice = Number(pi.buyPriceUsd || 0);
                  const sellPrice = Number(pi.sellPriceUsd || buyPrice * 1.5);
                  totalAmountUsd += qty * buyPrice;

                  const prodId = String(pi.productId);
                  const batchNum = String(pi.batchNumber || 'BATCH-01');
                  const batchId = pi.batchId ? String(pi.batchId) : undefined;
                  const expiryDate = pi.expiryDate
                    ? new Date(String(pi.expiryDate))
                    : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

                  const prodExists = await tx.product.findUnique({ where: { id: prodId } });
                  if (!prodExists) continue;

                  await tx.product.update({
                    where: { id: prodId },
                    data: { buyPriceUsd: buyPrice, sellPriceUsd: sellPrice },
                  });

                  const batch = await tx.productBatch.upsert({
                    where: {
                      branchId_productId_batchNumber: {
                        branchId: item.branchId,
                        productId: prodId,
                        batchNumber: batchNum,
                      },
                    },
                    update: {
                      expiryDate,
                      buyPriceUsd: buyPrice,
                      sellPriceUsd: sellPrice,
                      version: { increment: 1 },
                    },
                    create: {
                      ...(batchId ? { id: batchId } : {}),
                      branchId: item.branchId,
                      productId: prodId,
                      batchNumber: batchNum,
                      expiryDate,
                      buyPriceUsd: buyPrice,
                      sellPriceUsd: sellPrice,
                      cachedQuantity: 0,
                      supplierId: supplier.id,
                    },
                  });

                  await appendStockMovement(tx, {
                    id: `${item.entityId}-${batch.id}`,
                    branchId: item.branchId,
                    productId: prodId,
                    batchId: batch.id,
                    userId: req.user!.id,
                    type: StockMovementType.PURCHASE,
                    quantityDelta: qty,
                    unitCostUsd: buyPrice,
                    referenceId: item.entityId,
                    referenceType: 'PURCHASE',
                    reason: `Purchase Invoice #${String(p.invoiceNumber || 'INV')}`,
                    allowNegativeInOfflineSync: true,
                  });
                }

                await tx.purchase.upsert({
                  where: { id: item.entityId },
                  update: {},
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    supplierId: supplier.id,
                    invoiceNumber: String(p.invoiceNumber || 'INV-SYNC'),
                    totalAmountUsd: Number(totalAmountUsd.toFixed(2)),
                    paidAmountUsd: Number(p.paidAmountUsd || 0),
                    items: JSON.parse(JSON.stringify(purchaseItems)),
                    notes: p.notes ? String(p.notes) : null,
                    receivedById: req.user!.id,
                  },
                });
                break;
              }

              case 'Customer': {
                await tx.customer.upsert({
                  where: { id: item.entityId },
                  update: {
                    name: String(p.name),
                    phone: String(p.phone),
                    villageOrFarm: p.villageOrFarm ? String(p.villageOrFarm) : null,
                    creditLimitUsd: Number(p.creditLimitUsd ?? 100),
                    ...(p.currentBalanceUsd !== undefined
                      ? { currentBalanceUsd: Number(p.currentBalanceUsd) }
                      : {}),
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    name: String(p.name),
                    phone: String(p.phone),
                    villageOrFarm: p.villageOrFarm ? String(p.villageOrFarm) : null,
                    creditLimitUsd: Number(p.creditLimitUsd ?? 100),
                    currentBalanceUsd: Number(p.currentBalanceUsd ?? 0),
                  },
                });
                break;
              }

              case 'CreditRepayment': {
                const existingEntry = await tx.creditLedger.findUnique({
                  where: { id: item.entityId },
                });
                if (!existingEntry) {
                  const custId = String(p.customerId);
                  const currency = (p.currency as Currency) || 'USD';
                  const rate = Number(p.exchangeRateUsed || 8500);
                  const orig = Number(p.amountOriginal || 0);
                  const amountUsd =
                    currency === 'USD'
                      ? Number(orig.toFixed(2))
                      : Number((orig / rate).toFixed(2));

                  const cust = await tx.customer.findUnique({ where: { id: custId } });
                  if (cust) {
                    const updatedCust = await tx.customer.update({
                      where: { id: custId },
                      data: {
                        currentBalanceUsd: { decrement: amountUsd },
                        version: { increment: 1 },
                      },
                    });

                    await tx.creditLedger.create({
                      data: {
                        id: item.entityId,
                        branchId: item.branchId,
                        customerId: custId,
                        type: CreditTransactionType.PAYMENT,
                        amountDeltaUsd: -Math.abs(amountUsd),
                        balanceAfterUsd: updatedCust.currentBalanceUsd,
                        isSettled: Number(updatedCust.currentBalanceUsd) <= 0,
                        paymentMethod: (p.method as PaymentMethod) || 'CASH',
                        notes: p.notes ? String(p.notes) : 'Synced Credit Repayment',
                        recordedById: req.user!.id,
                      },
                    });

                    await tx.payment.create({
                      data: {
                        branchId: item.branchId,
                        creditLedgerId: item.entityId,
                        method: (p.method as PaymentMethod) || 'CASH',
                        currency,
                        amountOriginal: orig,
                        amountUsd,
                        exchangeRateUsed: rate,
                        referencePhone: p.referencePhone ? String(p.referencePhone) : null,
                      },
                    });
                  }
                }
                break;
              }

              case 'Expense': {
                await tx.expense.upsert({
                  where: { id: item.entityId },
                  update: {
                    category: String(p.category),
                    amountUsd: Number(p.amountUsd),
                    payee: String(p.payee),
                    approvalStatus: (p.approvalStatus as ApprovalStatus) || 'PENDING',
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    category: String(p.category),
                    amountUsd: Number(p.amountUsd),
                    currencyPaid: (p.currencyPaid as Currency) || 'USD',
                    amountOriginal: Number(p.amountOriginal || p.amountUsd),
                    exchangeRateUsed: Number(p.exchangeRateUsed || 8500),
                    paymentMethod: (p.paymentMethod as PaymentMethod) || 'CASH',
                    payee: String(p.payee),
                    description: p.description ? String(p.description) : null,
                    receiptPhotoData: p.receiptPhotoData ? String(p.receiptPhotoData) : null,
                    approvalStatus: (p.approvalStatus as ApprovalStatus) || 'PENDING',
                    isRecurring: Boolean(p.isRecurring),
                    recurringFrequency: p.recurringFrequency
                      ? String(p.recurringFrequency)
                      : null,
                    createdById: req.user!.id,
                  },
                });
                break;
              }

              case 'ExpenseApproval': {
                const expId = String(p.expenseId || item.entityId);
                const exists = await tx.expense.findUnique({ where: { id: expId } });
                if (exists) {
                  await tx.expense.update({
                    where: { id: expId },
                    data: {
                      approvalStatus: (p.status as ApprovalStatus) || 'APPROVED',
                      approvedById: req.user!.id,
                      approvedAt: new Date(),
                      version: { increment: 1 },
                    },
                  });
                }
                break;
              }

              case 'Quotation': {
                const qNum = String(
                  p.quotationNumber || `QTN-${item.entityId.slice(0, 6).toUpperCase()}`
                );
                await tx.quotation.upsert({
                  where: { id: item.entityId },
                  update: {
                    status: (p.status as QuotationStatus) || 'SENT',
                    convertedSaleId: p.convertedSaleId ? String(p.convertedSaleId) : null,
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    quotationNumber: qNum,
                    customerId: null,
                    customerName: p.customerName ? String(p.customerName) : 'Walk-in Client',
                    customerPhone: p.customerPhone ? String(p.customerPhone) : '',
                    status: (p.status as QuotationStatus) || 'SENT',
                    currency: (p.currency as Currency) || 'USD',
                    exchangeRateUsed: Number(p.exchangeRateUsed || 8500),
                    subtotalUsd: Number(p.subtotalUsd || p.totalUsd || 0),
                    discountUsd: Number(p.discountUsd || 0),
                    totalUsd: Number(p.totalUsd || 0),
                    totalSlsh: Number(p.totalSlsh || 0),
                    validUntil: p.validUntil
                      ? new Date(String(p.validUntil))
                      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    notes: p.notes ? String(p.notes) : null,
                    createdById: req.user!.id,
                  },
                });
                break;
              }

              case 'StockTransfer': {
                const trfNumber = String(
                  p.transferNumber || `TRF-${item.entityId.slice(0, 6).toUpperCase()}`
                );
                await tx.stockTransfer.upsert({
                  where: { id: item.entityId },
                  update: {
                    status: (p.status as TransferStatus) || 'COMPLETED',
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    destinationBranchId: String(p.destinationBranchId),
                    transferNumber: trfNumber,
                    status: (p.status as TransferStatus) || 'COMPLETED',
                    items: JSON.parse(JSON.stringify([p])),
                    notes: p.notes ? String(p.notes) : null,
                    initiatedById: req.user!.id,
                    receivedById: req.user!.id,
                    dispatchedAt: new Date(),
                    completedAt: new Date(),
                  },
                });
                break;
              }

              case 'BranchSettings': {
                await tx.branch.update({
                  where: { id: item.branchId },
                  data: {
                    ...(p.exchangeRate !== undefined
                      ? { exchangeRate: Number(p.exchangeRate) }
                      : {}),
                    ...(p.taxRate !== undefined ? { taxRate: Number(p.taxRate) } : {}),
                    ...(p.receiptHeader !== undefined
                      ? { receiptHeader: String(p.receiptHeader) }
                      : {}),
                    ...(p.receiptFooter !== undefined
                      ? { receiptFooter: String(p.receiptFooter) }
                      : {}),
                    ...(p.defaultLang !== undefined
                      ? { defaultLang: String(p.defaultLang) }
                      : {}),
                    version: { increment: 1 },
                  },
                });
                break;
              }

              case 'Appointment': {
                await tx.appointment.upsert({
                  where: { id: item.entityId },
                  update: {
                    status: (p.status as AppointmentStatus) || 'BOOKED',
                    diagnosis: p.diagnosis ? String(p.diagnosis) : null,
                    treatmentNotes: p.treatmentNotes ? String(p.treatmentNotes) : null,
                    prescriptionText: p.prescriptionText ? String(p.prescriptionText) : null,
                    reminderSent: Boolean(p.reminderSent),
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    assignedStaffId: req.user!.id,
                    patientOrOwner: String(p.patientOrOwner),
                    phone: String(p.phone),
                    status: (p.status as AppointmentStatus) || 'BOOKED',
                    visitType: (p.visitType as VisitType) || 'CLINIC_VISIT',
                    scheduledAt: new Date(String(p.scheduledAt || new Date().toISOString())),
                    patientAge: p.patientAge ? Number(p.patientAge) : null,
                    patientGender: p.patientGender ? String(p.patientGender) : null,
                    symptoms: p.symptoms ? String(p.symptoms) : null,
                    species: p.species ? (p.species as Species) : null,
                    animalCount: p.animalCount ? Number(p.animalCount) : null,
                    villageOrFarm: p.villageOrFarm ? String(p.villageOrFarm) : null,
                    diagnosis: p.diagnosis ? String(p.diagnosis) : null,
                    treatmentNotes: p.treatmentNotes ? String(p.treatmentNotes) : null,
                    prescriptionText: p.prescriptionText ? String(p.prescriptionText) : null,
                    followUpDate: p.followUpDate ? new Date(String(p.followUpDate)) : null,
                    reminderSent: Boolean(p.reminderSent),
                  },
                });
                break;
              }

              case 'Task': {
                await tx.task.upsert({
                  where: { id: item.entityId },
                  update: {
                    status: (p.status as TaskStatus) || 'OPEN',
                    version: { increment: 1 },
                  },
                  create: {
                    id: item.entityId,
                    branchId: item.branchId,
                    title: String(p.title),
                    description: p.description ? String(p.description) : null,
                    assignedToId: p.assignedToId ? String(p.assignedToId) : null,
                    createdById: req.user!.id,
                    status: (p.status as TaskStatus) || 'OPEN',
                    priority: (p.priority as TaskPriority) || 'MEDIUM',
                    dueDate: p.dueDate ? new Date(String(p.dueDate)) : null,
                  },
                });
                break;
              }

              default:
                break;
            }

            // Record processed SyncQueue log on server
            await tx.syncQueue.upsert({
              where: { id: item.id },
              update: {
                status: 'COMPLETED',
                syncedAt: new Date(),
              },
              create: {
                id: item.id,
                branchId: item.branchId,
                clientDeviceId: deviceId,
                userId: req.user!.id,
                entityType: item.entityType,
                entityId: item.entityId,
                operation: item.operation,
                payload: JSON.parse(JSON.stringify(p)),
                baseVersion: item.baseVersion || 1,
                status: 'COMPLETED',
                syncedAt: new Date(),
              },
            });
          });

          results.push({
            queueId: item.id,
            entityId: item.entityId,
            status: 'COMPLETED',
          });
        } catch (itemErr: unknown) {
          const errMsg = itemErr instanceof Error ? itemErr.message : 'SYNC_ITEM_ERROR';
          results.push({
            queueId: item.id,
            entityId: item.entityId,
            status: 'FAILED',
            errorMessage: errMsg,
          });
        }
      }

      res.json({ results, serverTimestamp: new Date().toISOString() });
    } catch (error) {
      console.error('[Sync] Push error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * GET /api/sync/pull
 * Pulls full normalized state for the user's branch scope so all devices stay 100% in sync:
 * - Converts Prisma Decimals to standard numbers for IndexedDB compatibility.
 * - Includes flattened `saleItems` and `payments` arrays for receipts & analytics across devices.
 * - Enforces per-user isolation for VET_OFFICER accounts (`vet_b2`, `vet_b3`).
 */
syncRouter.get(
  '/pull',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const baseWhere = scopedWhere(req);
      const isVetOfficer = req.user?.role === 'VET_OFFICER';
      const userId = req.user!.id;

      const [
        rawBranches,
        rawProducts,
        rawBatches,
        rawStockMovements,
        rawTransfers,
        rawCustomers,
        rawSales,
        rawExpenses,
        rawQuotations,
        rawAppointments,
        rawTasks,
        rawCreditLedger,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { deletedAt: null } }),
        prisma.product.findMany({ where: baseWhere }),
        prisma.productBatch.findMany({ where: baseWhere }),
        prisma.stockMovement.findMany({
          where: baseWhere,
        }),
        prisma.stockTransfer.findMany({ where: baseWhere }),
        prisma.customer.findMany({ where: baseWhere }),
        prisma.sale.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { cashierId: userId } : {}),
          },
          include: {
            cashier: { select: { id: true, fullName: true, username: true } },
            customer: { select: { id: true, name: true, phone: true } },
            items: {
              include: {
                product: {
                  select: {
                    name: true,
                    sku: true,
                    dosePerKg: true,
                    withdrawalPeriodDays: true,
                  },
                },
                batch: { select: { batchNumber: true, expiryDate: true } },
              },
            },
            payments: true,
          },
          orderBy: { soldAt: 'desc' },
        }),
        prisma.expense.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { createdById: userId } : {}),
          },
        }),
        prisma.quotation.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { createdById: userId } : {}),
          },
          include: {
            items: {
              include: {
                product: { select: { name: true, sku: true } },
              },
            },
          },
        }),
        prisma.appointment.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { assignedStaffId: userId } : {}),
          },
        }),
        prisma.task.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { createdById: userId } : {}),
          },
        }),
        prisma.creditLedger.findMany({
          where: {
            ...baseWhere,
            ...(isVetOfficer ? { recordedById: userId } : {}),
          },
        }),
      ]);

      // Verify ledger balance for batches
      await prisma.$transaction(async (tx) => {
        for (const b of rawBatches) {
          await recalculateBatchBalanceFromLedger(tx, b.branchId, b.id);
        }
      });

      const branches = rawBranches.map((b) => ({
        ...b,
        exchangeRate: Number(b.exchangeRate),
        taxRate: Number(b.taxRate),
      }));

      const products = rawProducts.map((p) => ({
        ...p,
        buyPriceUsd: Number(p.buyPriceUsd),
        sellPriceUsd: Number(p.sellPriceUsd),
        createdById: 'seed-user',
      }));

      const batches = rawBatches.map((b) => ({
        ...b,
        buyPriceUsd: Number(b.buyPriceUsd),
        sellPriceUsd: Number(b.sellPriceUsd),
        cachedQuantity: Number(b.cachedQuantity),
        expiryDate: b.expiryDate.toISOString(),
        createdById: 'seed-user',
      }));

      const stockMovements = rawStockMovements.map((m) => ({
        ...m,
        quantityDelta: Number(m.quantityDelta),
        unitCostUsd: m.unitCostUsd !== null ? Number(m.unitCostUsd) : undefined,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));

      const customers = rawCustomers.map((c) => ({
        ...c,
        creditLimitUsd: Number(c.creditLimitUsd),
        currentBalanceUsd: Number(c.currentBalanceUsd),
        createdById: 'seed-user',
      }));

      const saleItems: Array<Record<string, unknown>> = [];
      const payments: Array<Record<string, unknown>> = [];

      const sales = rawSales.map((s) => {
        for (const si of s.items) {
          saleItems.push({
            id: si.id,
            branchId: si.branchId,
            saleId: si.saleId,
            productId: si.productId,
            productName: si.product?.name || 'Item',
            sku: si.product?.sku || '',
            batchId: si.batchId,
            batchNumber: si.batch?.batchNumber || 'FEFO',
            expiryDate: si.batch?.expiryDate ? si.batch.expiryDate.toISOString() : '',
            quantity: Number(si.quantity),
            refundedQuantity: Number(si.refundedQuantity || 0),
            unitBuyPriceUsd: Number(si.unitBuyPriceUsd),
            unitPriceUsd: Number(si.unitPriceUsd),
            discountUsd: Number(si.discountUsd),
            subtotalUsd: Number(si.subtotalUsd),
            dosageNote: si.dosageNote,
            withdrawalPeriodDays: si.product?.withdrawalPeriodDays ?? null,
            version: si.version,
            createdAt: si.createdAt.toISOString(),
            updatedAt: si.updatedAt.toISOString(),
            deletedAt: null,
          });
        }

        for (const pay of s.payments) {
          payments.push({
            id: pay.id,
            branchId: pay.branchId,
            saleId: pay.saleId,
            creditLedgerId: pay.creditLedgerId,
            method: pay.method,
            currency: pay.currency,
            amountOriginal: Number(pay.amountOriginal),
            amountUsd: Number(pay.amountUsd),
            exchangeRateUsed: Number(pay.exchangeRateUsed),
            referencePhone: pay.referencePhone,
            transactionRef: pay.transactionRef,
            paidAt: pay.paidAt.toISOString(),
            version: pay.version,
            createdAt: pay.createdAt.toISOString(),
            updatedAt: pay.updatedAt.toISOString(),
            deletedAt: null,
          });
        }

        return {
          id: s.id,
          branchId: s.branchId,
          receiptNumber: s.receiptNumber,
          cashierId: s.cashierId,
          createdById: s.cashierId,
          cashierName: s.cashier?.fullName || 'Cashier',
          customerId: s.customerId,
          customerName: s.customer?.name || null,
          status: s.status,
          currency: s.currency,
          exchangeRateUsed: Number(s.exchangeRateUsed),
          subtotalUsd: Number(s.subtotalUsd),
          discountUsd: Number(s.discountUsd),
          taxUsd: Number(s.taxUsd),
          totalUsd: Number(s.totalUsd),
          totalSlsh: Number(s.totalSlsh),
          paidUsd: Number(s.paidUsd),
          creditAmountUsd: Number(s.creditAmountUsd),
          changeUsd: Number(s.changeUsd),
          approvedById: s.approvedById,
          voidOrRefundReason: s.voidOrRefundReason,
          voidedAt: s.voidedAt ? s.voidedAt.toISOString() : null,
          prescriptionRef: s.prescriptionRef,
          notes: s.notes,
          soldAt: s.soldAt.toISOString(),
          version: s.version,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          deletedAt: null,
        };
      });

      const expenses = rawExpenses.map((e) => ({
        ...e,
        amountUsd: Number(e.amountUsd),
        amountOriginal: Number(e.amountOriginal),
        exchangeRateUsed: Number(e.exchangeRateUsed),
        expenseDate: e.expenseDate.toISOString(),
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      }));

      const quotations = rawQuotations.map((q) => ({
        ...q,
        exchangeRateUsed: Number(q.exchangeRateUsed),
        subtotalUsd: Number(q.subtotalUsd),
        discountUsd: Number(q.discountUsd),
        totalUsd: Number(q.totalUsd),
        totalSlsh: Number(q.totalSlsh),
        validUntil: q.validUntil.toISOString(),
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
        items: q.items.map((qi) => ({
          productId: qi.productId,
          productName: qi.product?.name || 'Item',
          sku: qi.product?.sku || '',
          quantity: Number(qi.quantity),
          unitPriceUsd: Number(qi.unitPriceUsd),
        })),
      }));

      const appointments = rawAppointments.map((a) => ({
        ...a,
        createdById: a.assignedStaffId,
        scheduledAt: a.scheduledAt.toISOString(),
        followUpDate: a.followUpDate ? a.followUpDate.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));

      const tasks = rawTasks.map((t) => ({
        ...t,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }));

      const creditLedger = rawCreditLedger.map((cl) => ({
        ...cl,
        amountDeltaUsd: Number(cl.amountDeltaUsd),
        balanceAfterUsd: Number(cl.balanceAfterUsd),
        dueDate: cl.dueDate ? cl.dueDate.toISOString() : null,
        createdAt: cl.createdAt.toISOString(),
        updatedAt: cl.updatedAt.toISOString(),
      }));

      res.json({
        serverTimestamp: new Date().toISOString(),
        branches,
        products,
        batches,
        stockMovements,
        transfers: rawTransfers,
        customers,
        sales,
        saleItems,
        payments,
        expenses,
        quotations,
        appointments,
        tasks,
        creditLedger,
      });
    } catch (error) {
      console.error('[Sync] Pull error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

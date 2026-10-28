import { Router, Request, Response } from 'express';
import {
  AppointmentStatus,
  ApprovalStatus,
  Currency,
  PaymentMethod,
  Species,
  StockMovementType,
  TaskPriority,
  TaskStatus,
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
        // Strict branch guard: non-admin can only push items for their own branch
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
            const p = item.payload;

            switch (item.entityType) {
              case 'StockMovement': {
                await appendStockMovement(tx, {
                  id: String(p.id || item.entityId),
                  branchId: item.branchId,
                  productId: String(p.productId),
                  batchId: String(p.batchId),
                  userId: req.user!.id,
                  type: (p.type as StockMovementType) || StockMovementType.ADJUSTMENT_MINUS,
                  quantityDelta: Number(p.quantityDelta),
                  unitCostUsd: p.unitCostUsd !== undefined ? Number(p.unitCostUsd) : undefined,
                  referenceId: p.referenceId ? String(p.referenceId) : undefined,
                  referenceType: p.referenceType ? String(p.referenceType) : 'OFFLINE_SYNC',
                  reason: p.reason ? String(p.reason) : 'Synced offline stock movement',
                  allowNegativeInOfflineSync: true,
                });
                break;
              }

              case 'Product': {
                await tx.product.upsert({
                  where: { id: item.entityId },
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
                    id: item.entityId,
                    branchId: item.branchId,
                    categoryId: String(p.categoryId),
                    unitId: String(p.unitId),
                    sku: String(p.sku),
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

              case 'Customer': {
                await tx.customer.upsert({
                  where: { id: item.entityId },
                  update: {
                    name: String(p.name),
                    phone: String(p.phone),
                    villageOrFarm: p.villageOrFarm ? String(p.villageOrFarm) : null,
                    creditLimitUsd: Number(p.creditLimitUsd ?? 100),
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
                    scheduledAt: new Date(String(p.scheduledAt)),
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
 * Pulls delta updates from server since `since` timestamp for the user's branch scope.
 * Ensures all batch quantities reflect the true StockMovement ledger sum.
 */
syncRouter.get(
  '/pull',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sinceParam = req.query.since as string | undefined;
      const sinceDate = sinceParam ? new Date(sinceParam) : new Date(0);

      const deltaWhere = {
        ...scopedWhere(req),
        updatedAt: { gte: sinceDate },
      };

      const [
        branches,
        products,
        batches,
        stockMovements,
        customers,
        sales,
        expenses,
        quotations,
        appointments,
        tasks,
        creditLedger,
      ] = await Promise.all([
        prisma.branch.findMany({ where: { deletedAt: null } }),
        prisma.product.findMany({ where: deltaWhere }),
        prisma.productBatch.findMany({ where: deltaWhere }),
        prisma.stockMovement.findMany({ where: deltaWhere }),
        prisma.customer.findMany({ where: deltaWhere }),
        prisma.sale.findMany({ where: deltaWhere }),
        prisma.expense.findMany({ where: deltaWhere }),
        prisma.quotation.findMany({ where: deltaWhere }),
        prisma.appointment.findMany({ where: deltaWhere }),
        prisma.task.findMany({ where: deltaWhere }),
        prisma.creditLedger.findMany({ where: deltaWhere }),
      ]);

      // Verify ledger balance for any updated batches
      await prisma.$transaction(async (tx) => {
        for (const b of batches) {
          await recalculateBatchBalanceFromLedger(tx, b.branchId, b.id);
        }
      });

      res.json({
        serverTimestamp: new Date().toISOString(),
        branches,
        products,
        batches,
        stockMovements,
        customers,
        sales,
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

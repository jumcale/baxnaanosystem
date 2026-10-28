import { Router, Request, Response } from 'express';
import { Species, StockMovementType } from '@prisma/client';
import { prisma } from '../config/db';
import {
  authenticateJWT,
  enforceBranchScope,
  requirePermissions,
  scopedWhere,
} from '../middleware/auth';
import {
  CategorySchema,
  UnitSchema,
  SupplierSchema,
  ProductSchema,
  CreatePurchaseSchema,
  StockAdjustmentSchema,
  StockTakeSubmissionSchema,
  CreateTransferSchema,
  classifyExpiryBucket,
} from '@baxnaano/shared';
import {
  appendStockMovement,
  recalculateBatchBalanceFromLedger,
} from '../services/inventory.service';
import { recordAuditLog } from '../utils/audit';

export const inventoryRouter = Router();

// All inventory routes require JWT authentication and strict branch scoping
inventoryRouter.use(authenticateJWT);

// ============================================================================
// 1. CATEGORIES, UNITS & SUPPLIERS
// ============================================================================

inventoryRouter.get(
  '/metadata',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const [categories, units, suppliers] = await Promise.all([
        prisma.category.findMany({
          where: scopedWhere(req),
          orderBy: { name: 'asc' },
        }),
        prisma.unit.findMany({
          where: scopedWhere(req),
          orderBy: { name: 'asc' },
        }),
        prisma.supplier.findMany({
          where: scopedWhere(req),
          orderBy: { name: 'asc' },
        }),
      ]);

      res.json({ categories, units, suppliers });
    } catch (error) {
      console.error('[Inventory] Metadata error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

inventoryRouter.post(
  '/categories',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CategorySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const category = await prisma.category.upsert({
        where: {
          branchId_name: {
            branchId: parsed.data.branchId,
            name: parsed.data.name,
          },
        },
        update: {
          nameSo: parsed.data.nameSo,
          description: parsed.data.description,
          deletedAt: null,
          version: { increment: 1 },
        },
        create: parsed.data,
      });
      res.status(201).json({ category });
    } catch (error) {
      console.error('[Inventory] Category create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

inventoryRouter.post(
  '/units',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = UnitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const unit = await prisma.unit.upsert({
        where: {
          branchId_name: {
            branchId: parsed.data.branchId,
            name: parsed.data.name,
          },
        },
        update: {
          abbreviation: parsed.data.abbreviation,
          deletedAt: null,
          version: { increment: 1 },
        },
        create: parsed.data,
      });
      res.status(201).json({ unit });
    } catch (error) {
      console.error('[Inventory] Unit create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

inventoryRouter.post(
  '/suppliers',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = SupplierSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const supplier = await prisma.supplier.create({
        data: parsed.data,
      });
      res.status(201).json({ supplier });
    } catch (error) {
      console.error('[Inventory] Supplier create error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 2. PRODUCTS (Pharmacy & Veterinary Specific Fields + FEFO Batch Summary)
// ============================================================================

inventoryRouter.get(
  '/products',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const search = (req.query.search as string | undefined)?.trim();
      const categoryId = req.query.categoryId as string | undefined;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      const where = scopedWhere(req, {
        ...(categoryId ? { categoryId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { sku: { contains: search, mode: 'insensitive' as const } },
                { barcode: { contains: search, mode: 'insensitive' as const } },
                { genericName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      });

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            category: true,
            unit: true,
            branch: { select: { id: true, code: true, name: true, type: true } },
            batches: {
              where: { deletedAt: null },
              orderBy: { expiryDate: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
          skip,
          take: limit,
        }),
        prisma.product.count({ where }),
      ]);

      // Enrich each product with sellable (non-expired) stock, expired stock, and earliest expiry (FEFO)
      const enriched = products.map((p) => {
        let sellableStock = 0;
        let expiredStock = 0;
        let earliestExpiry: Date | null = null;

        const batchesWithStatus = p.batches.map((b) => {
          const { bucket, daysUntilExpiry } = classifyExpiryBucket(b.expiryDate);
          if (bucket === 'EXPIRED') {
            expiredStock += Math.max(0, b.cachedQuantity);
          } else if (b.cachedQuantity > 0) {
            sellableStock += b.cachedQuantity;
            if (!earliestExpiry || b.expiryDate < earliestExpiry) {
              earliestExpiry = b.expiryDate;
            }
          }
          return {
            ...b,
            expiryBucket: bucket,
            daysUntilExpiry,
          };
        });

        return {
          ...p,
          batches: batchesWithStatus,
          sellableStock,
          expiredStock,
          totalStock: sellableStock + expiredStock,
          isLowStock: sellableStock <= p.reorderLevel,
          earliestExpiry,
        };
      });

      res.json({
        products: enriched,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('[Inventory] Get products error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

inventoryRouter.post(
  '/products',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = ProductSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const existing = data.id
        ? await prisma.product.findUnique({ where: { id: data.id } })
        : await prisma.product.findUnique({
            where: { branchId_sku: { branchId: data.branchId, sku: data.sku } },
          });

      const product = await prisma.product.upsert({
        where: existing ? { id: existing.id } : { branchId_sku: { branchId: data.branchId, sku: data.sku } },
        update: {
          categoryId: data.categoryId,
          unitId: data.unitId,
          barcode: data.barcode ?? null,
          name: data.name,
          description: data.description ?? null,
          buyPriceUsd: data.buyPriceUsd,
          sellPriceUsd: data.sellPriceUsd,
          reorderLevel: data.reorderLevel,
          genericName: data.genericName ?? null,
          dosageForm: data.dosageForm ?? null,
          strength: data.strength ?? null,
          isPrescriptionOnly: data.isPrescriptionOnly,
          targetSpecies: data.targetSpecies as Species[],
          dosePerKg: data.dosePerKg ?? null,
          withdrawalPeriodDays: data.withdrawalPeriodDays ?? null,
          isColdChainRequired: data.isColdChainRequired,
          version: { increment: 1 },
          deletedAt: null,
        },
        create: {
          id: data.id,
          branchId: data.branchId,
          categoryId: data.categoryId,
          unitId: data.unitId,
          sku: data.sku,
          barcode: data.barcode ?? null,
          name: data.name,
          description: data.description ?? null,
          buyPriceUsd: data.buyPriceUsd,
          sellPriceUsd: data.sellPriceUsd,
          reorderLevel: data.reorderLevel,
          genericName: data.genericName ?? null,
          dosageForm: data.dosageForm ?? null,
          strength: data.strength ?? null,
          isPrescriptionOnly: data.isPrescriptionOnly,
          targetSpecies: data.targetSpecies as Species[],
          dosePerKg: data.dosePerKg ?? null,
          withdrawalPeriodDays: data.withdrawalPeriodDays ?? null,
          isColdChainRequired: data.isColdChainRequired,
        },
      });

      // Audit price changes if product existed
      if (
        existing &&
        (Number(existing.sellPriceUsd) !== data.sellPriceUsd ||
          Number(existing.buyPriceUsd) !== data.buyPriceUsd)
      ) {
        await recordAuditLog({
          branchId: product.branchId,
          userId: req.user!.id,
          action: 'PRICE_EDIT',
          entityType: 'Product',
          entityId: product.id,
          oldData: { buyPriceUsd: existing.buyPriceUsd, sellPriceUsd: existing.sellPriceUsd },
          newData: { buyPriceUsd: product.buyPriceUsd, sellPriceUsd: product.sellPriceUsd },
          ipAddress: req.ip,
        });
      }

      res.status(201).json({ product });
    } catch (error) {
      console.error('[Inventory] Save product error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 3. STOCK IN: PURCHASES & BATCH RECEIVING (Transactional + Ledger Append)
// ============================================================================

inventoryRouter.post(
  '/purchases',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:write'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreatePurchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const totalAmountUsd = data.items.reduce(
        (sum, item) => sum + item.quantity * item.buyPriceUsd,
        0
      );

      const result = await prisma.$transaction(async (tx) => {
        // Idempotency check if offline client retries same purchase UUID
        if (data.id) {
          const existingPurchase = await tx.purchase.findUnique({ where: { id: data.id } });
          if (existingPurchase) return existingPurchase;
        }

        const processedItems = [];

        for (const item of data.items) {
          const batch = await tx.productBatch.upsert({
            where: {
              branchId_productId_batchNumber: {
                branchId: data.branchId,
                productId: item.productId,
                batchNumber: item.batchNumber,
              },
            },
            update: {
              expiryDate: new Date(item.expiryDate),
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              supplierId: data.supplierId,
              deletedAt: null,
              version: { increment: 1 },
            },
            create: {
              id: item.batchId,
              branchId: data.branchId,
              productId: item.productId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              manufacturingDate: item.manufacturingDate ? new Date(item.manufacturingDate) : null,
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              supplierId: data.supplierId,
              cachedQuantity: 0,
            },
          });

          // Update product latest buy/sell price
          await tx.product.update({
            where: { id: item.productId },
            data: {
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              version: { increment: 1 },
            },
          });

          processedItems.push({
            ...item,
            batchId: batch.id,
          });
        }

        const purchase = await tx.purchase.create({
          data: {
            id: data.id,
            branchId: data.branchId,
            supplierId: data.supplierId,
            invoiceNumber: data.invoiceNumber,
            purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : new Date(),
            totalAmountUsd,
            paidAmountUsd: data.paidAmountUsd,
            items: processedItems,
            notes: data.notes ?? null,
            receivedById: req.user!.id,
          },
        });

        // Append PURCHASE StockMovement for each batch and recalculate ledger sum
        for (const item of processedItems) {
          await appendStockMovement(tx, {
            branchId: data.branchId,
            productId: item.productId,
            batchId: item.batchId,
            userId: req.user!.id,
            type: StockMovementType.PURCHASE,
            quantityDelta: item.quantity,
            unitCostUsd: item.buyPriceUsd,
            referenceId: purchase.id,
            referenceType: 'PURCHASE',
            reason: `Purchase Invoice #${data.invoiceNumber}`,
          });
        }

        // Update supplier balance if unpaid portion remains
        const unpaidUsd = totalAmountUsd - data.paidAmountUsd;
        if (unpaidUsd > 0) {
          await tx.supplier.update({
            where: { id: data.supplierId },
            data: {
              balanceUsd: { increment: unpaidUsd },
              version: { increment: 1 },
            },
          });
        }

        return purchase;
      });

      await recordAuditLog({
        branchId: data.branchId,
        userId: req.user!.id,
        action: 'PURCHASE_STOCK_IN',
        entityType: 'Purchase',
        entityId: result.id,
        newData: { invoiceNumber: data.invoiceNumber, totalAmountUsd },
        ipAddress: req.ip,
      });

      res.status(201).json({ purchase: result });
    } catch (error) {
      console.error('[Inventory] Purchase stock-in error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 4. STOCK ADJUSTMENTS & DAMAGES (Audit-Logged + Ledger Movement)
// ============================================================================

inventoryRouter.post(
  '/adjustments',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:adjust'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = StockAdjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const signedDelta =
        data.type === 'ADJUSTMENT_PLUS' ? Math.abs(data.quantity) : -Math.abs(data.quantity);

      const result = await prisma.$transaction(async (tx) => {
        return appendStockMovement(tx, {
          id: data.id,
          branchId: data.branchId,
          productId: data.productId,
          batchId: data.batchId,
          userId: req.user!.id,
          type: data.type as StockMovementType,
          quantityDelta: signedDelta,
          referenceType: 'ADJUSTMENT',
          reason: data.reason,
        });
      });

      await recordAuditLog({
        branchId: data.branchId,
        userId: req.user!.id,
        action: 'STOCK_ADJUST',
        entityType: 'StockMovement',
        entityId: result.movement.id,
        newData: {
          batchId: data.batchId,
          type: data.type,
          quantityDelta: signedDelta,
          newBatchQuantity: result.newBatchQuantity,
        },
        reason: data.reason,
        ipAddress: req.ip,
      });

      res.status(201).json(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      if (msg.startsWith('INSUFFICIENT_BATCH_STOCK')) {
        res.status(400).json({ error: 'INSUFFICIENT_BATCH_STOCK', details: msg });
        return;
      }
      console.error('[Inventory] Adjustment error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 5. STOCK TAKE (Physical Count vs System Ledger + Variance Report & Reconciliation)
// ============================================================================

inventoryRouter.post(
  '/stock-take',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:stock_take'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = StockTakeSubmissionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      const stockTakeId = data.id || `ST-${Date.now()}`;

      const varianceReport = await prisma.$transaction(async (tx) => {
        const itemsReport = [];

        for (const entry of data.entries) {
          const systemQty = await recalculateBatchBalanceFromLedger(
            tx,
            data.branchId,
            entry.batchId
          );

          const batch = await tx.productBatch.findUnique({
            where: { id: entry.batchId },
            include: { product: true },
          });

          if (!batch) continue;

          const variance = entry.physicalCount - systemQty;

          if (variance !== 0) {
            await appendStockMovement(tx, {
              branchId: data.branchId,
              productId: entry.productId,
              batchId: entry.batchId,
              userId: req.user!.id,
              type: StockMovementType.STOCK_TAKE_VARIANCE,
              quantityDelta: variance,
              unitCostUsd: Number(batch.buyPriceUsd),
              referenceId: stockTakeId,
              referenceType: 'STOCK_TAKE',
              reason: `${data.reason} (System: ${systemQty}, Counted: ${entry.physicalCount})`,
            });
          }

          itemsReport.push({
            productId: entry.productId,
            productName: batch.product.name,
            sku: batch.product.sku,
            batchId: entry.batchId,
            batchNumber: batch.batchNumber,
            systemQuantity: systemQty,
            physicalCount: entry.physicalCount,
            variance,
            varianceValueUsd: Number((variance * Number(batch.buyPriceUsd)).toFixed(2)),
          });
        }

        return itemsReport;
      });

      await recordAuditLog({
        branchId: data.branchId,
        userId: req.user!.id,
        action: 'STOCK_TAKE_RECONCILE',
        entityType: 'StockTake',
        entityId: stockTakeId,
        newData: { entriesCount: varianceReport.length, variances: varianceReport.filter((r) => r.variance !== 0) },
        reason: data.reason,
        ipAddress: req.ip,
      });

      res.status(201).json({
        stockTakeId,
        reconciledAt: new Date().toISOString(),
        varianceReport,
      });
    } catch (error) {
      console.error('[Inventory] Stock take error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 6. INTER-BRANCH STOCK TRANSFERS (B1 <-> B2 <-> B3)
// ============================================================================

inventoryRouter.get(
  '/transfers',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const branchId = req.branchScope?.branchId;
      const where = branchId
        ? {
            deletedAt: null,
            OR: [{ branchId }, { destinationBranchId: branchId }],
          }
        : { deletedAt: null };

      const transfers = await prisma.stockTransfer.findMany({
        where,
        include: {
          sourceBranch: { select: { id: true, code: true, name: true } },
          destinationBranch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ transfers });
    } catch (error) {
      console.error('[Inventory] Get transfers error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * Dispatch an Inter-Branch Stock Transfer:
 * Deducts stock from Source Branch (`TRANSFER_OUT`) immediately and puts transfer in `IN_TRANSIT`.
 */
inventoryRouter.post(
  '/transfers',
  enforceBranchScope({ requireConcreteBranchForWrites: true }),
  requirePermissions('inventory:transfer'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = CreateTransferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }

      const data = parsed.data;
      if (data.branchId === data.destinationBranchId) {
        res.status(400).json({ error: 'SAME_SOURCE_AND_DESTINATION_BRANCH' });
        return;
      }

      const transferNumber = `TRF-${Date.now().toString().slice(-6)}`;

      const transfer = await prisma.$transaction(async (tx) => {
        const created = await tx.stockTransfer.create({
          data: {
            id: data.id,
            branchId: data.branchId,
            destinationBranchId: data.destinationBranchId,
            transferNumber,
            status: 'IN_TRANSIT',
            items: data.items,
            notes: data.notes ?? null,
            initiatedById: req.user!.id,
            dispatchedAt: new Date(),
          },
        });

        for (const item of data.items) {
          await appendStockMovement(tx, {
            branchId: data.branchId,
            productId: item.productId,
            batchId: item.sourceBatchId,
            userId: req.user!.id,
            type: StockMovementType.TRANSFER_OUT,
            quantityDelta: -Math.abs(item.quantity),
            unitCostUsd: item.buyPriceUsd,
            referenceId: created.id,
            referenceType: 'TRANSFER',
            reason: `Transfer Out ${transferNumber} to ${data.destinationBranchId}`,
          });
        }

        return created;
      });

      await recordAuditLog({
        branchId: data.branchId,
        userId: req.user!.id,
        action: 'STOCK_TRANSFER_DISPATCH',
        entityType: 'StockTransfer',
        entityId: transfer.id,
        newData: transfer,
        ipAddress: req.ip,
      });

      res.status(201).json({ transfer });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      if (msg.startsWith('INSUFFICIENT_BATCH_STOCK')) {
        res.status(400).json({ error: 'INSUFFICIENT_BATCH_STOCK', details: msg });
        return;
      }
      console.error('[Inventory] Create transfer error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

/**
 * Receive an Inter-Branch Stock Transfer at Destination Branch:
 * Creates/matches product & batch in destination branch and appends `TRANSFER_IN` movement.
 */
inventoryRouter.post(
  '/transfers/:id/receive',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:transfer'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const transferId = req.params.id;
      const existing = await prisma.stockTransfer.findUnique({
        where: { id: transferId },
      });

      if (!existing || existing.status !== 'IN_TRANSIT') {
        res.status(400).json({ error: 'TRANSFER_NOT_IN_TRANSIT' });
        return;
      }

      // Verify user belongs to destination branch or is ADMIN
      if (
        req.user!.role !== 'ADMIN' &&
        req.user!.branchId !== existing.destinationBranchId
      ) {
        res.status(403).json({ error: 'ONLY_DESTINATION_BRANCH_CAN_RECEIVE' });
        return;
      }

      const items = existing.items as Array<{
        productId: string;
        sku: string;
        productName: string;
        sourceBatchId: string;
        batchNumber: string;
        expiryDate: string;
        quantity: number;
        buyPriceUsd: number;
        sellPriceUsd: number;
      }>;

      const updatedTransfer = await prisma.$transaction(async (tx) => {
        for (const item of items) {
          // Find matching product by SKU in destination branch, or clone metadata from source product
          let destProduct = await tx.product.findUnique({
            where: {
              branchId_sku: {
                branchId: existing.destinationBranchId,
                sku: item.sku,
              },
            },
          });

          if (!destProduct) {
            const sourceProduct = await tx.product.findUnique({
              where: { id: item.productId },
              include: { category: true, unit: true },
            });

            if (!sourceProduct) {
              throw new Error(`SOURCE_PRODUCT_MISSING:${item.sku}`);
            }

            const destCategory = await tx.category.upsert({
              where: {
                branchId_name: {
                  branchId: existing.destinationBranchId,
                  name: sourceProduct.category.name,
                },
              },
              update: {},
              create: {
                branchId: existing.destinationBranchId,
                name: sourceProduct.category.name,
                nameSo: sourceProduct.category.nameSo,
              },
            });

            const destUnit = await tx.unit.upsert({
              where: {
                branchId_name: {
                  branchId: existing.destinationBranchId,
                  name: sourceProduct.unit.name,
                },
              },
              update: {},
              create: {
                branchId: existing.destinationBranchId,
                name: sourceProduct.unit.name,
                abbreviation: sourceProduct.unit.abbreviation,
              },
            });

            destProduct = await tx.product.create({
              data: {
                branchId: existing.destinationBranchId,
                categoryId: destCategory.id,
                unitId: destUnit.id,
                sku: sourceProduct.sku,
                barcode: sourceProduct.barcode,
                name: sourceProduct.name,
                description: sourceProduct.description,
                buyPriceUsd: item.buyPriceUsd,
                sellPriceUsd: item.sellPriceUsd,
                reorderLevel: sourceProduct.reorderLevel,
                genericName: sourceProduct.genericName,
                dosageForm: sourceProduct.dosageForm,
                strength: sourceProduct.strength,
                isPrescriptionOnly: sourceProduct.isPrescriptionOnly,
                targetSpecies: sourceProduct.targetSpecies,
                dosePerKg: sourceProduct.dosePerKg,
                withdrawalPeriodDays: sourceProduct.withdrawalPeriodDays,
                isColdChainRequired: sourceProduct.isColdChainRequired,
              },
            });
          }

          // Upsert destination batch
          const destBatch = await tx.productBatch.upsert({
            where: {
              branchId_productId_batchNumber: {
                branchId: existing.destinationBranchId,
                productId: destProduct.id,
                batchNumber: item.batchNumber,
              },
            },
            update: {
              expiryDate: new Date(item.expiryDate),
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              deletedAt: null,
            },
            create: {
              branchId: existing.destinationBranchId,
              productId: destProduct.id,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              buyPriceUsd: item.buyPriceUsd,
              sellPriceUsd: item.sellPriceUsd,
              cachedQuantity: 0,
            },
          });

          // Append TRANSFER_IN movement
          await appendStockMovement(tx, {
            branchId: existing.destinationBranchId,
            productId: destProduct.id,
            batchId: destBatch.id,
            userId: req.user!.id,
            type: StockMovementType.TRANSFER_IN,
            quantityDelta: Math.abs(item.quantity),
            unitCostUsd: item.buyPriceUsd,
            referenceId: existing.id,
            referenceType: 'TRANSFER',
            reason: `Transfer In ${existing.transferNumber} from ${existing.branchId}`,
          });
        }

        return tx.stockTransfer.update({
          where: { id: existing.id },
          data: {
            status: 'COMPLETED',
            receivedById: req.user!.id,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
      });

      await recordAuditLog({
        branchId: existing.destinationBranchId,
        userId: req.user!.id,
        action: 'STOCK_TRANSFER_RECEIVE',
        entityType: 'StockTransfer',
        entityId: updatedTransfer.id,
        newData: updatedTransfer,
        ipAddress: req.ip,
      });

      res.json({ transfer: updatedTransfer });
    } catch (error) {
      console.error('[Inventory] Receive transfer error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

// ============================================================================
// 7. EXPIRY & LOW STOCK ALERTS (30 / 60 / 90 Days + Expired) & LEDGER HISTORY
// ============================================================================

inventoryRouter.get(
  '/alerts',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const batches = await prisma.productBatch.findMany({
        where: {
          ...scopedWhere(req),
          cachedQuantity: { gt: 0 },
        },
        include: {
          product: { select: { id: true, name: true, sku: true, isColdChainRequired: true } },
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { expiryDate: 'asc' },
      });

      const expired: typeof batches = [];
      const expiring30: typeof batches = [];
      const expiring60: typeof batches = [];
      const expiring90: typeof batches = [];

      for (const b of batches) {
        const { bucket } = classifyExpiryBucket(b.expiryDate);
        if (bucket === 'EXPIRED') expired.push(b);
        else if (bucket === 'DAYS_30') expiring30.push(b);
        else if (bucket === 'DAYS_60') expiring60.push(b);
        else if (bucket === 'DAYS_90') expiring90.push(b);
      }

      res.json({
        expired,
        expiring30,
        expiring60,
        expiring90,
      });
    } catch (error) {
      console.error('[Inventory] Alerts error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

inventoryRouter.get(
  '/movements',
  enforceBranchScope({ requireConcreteBranchForWrites: false }),
  requirePermissions('inventory:view'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const productId = req.query.productId as string | undefined;
      const batchId = req.query.batchId as string | undefined;
      const limit = Math.min(200, Number(req.query.limit) || 100);

      const movements = await prisma.stockMovement.findMany({
        where: scopedWhere(req, {
          ...(productId ? { productId } : {}),
          ...(batchId ? { batchId } : {}),
        }),
        include: {
          product: { select: { id: true, name: true, sku: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          user: { select: { id: true, fullName: true, username: true } },
          branch: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      res.json({ movements });
    } catch (error) {
      console.error('[Inventory] Movements error:', error);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
);

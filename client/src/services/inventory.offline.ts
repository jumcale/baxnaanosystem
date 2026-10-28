import { v4 as uuidv4 } from 'uuid';
import {
  db,
  enqueueOfflineSyncItem,
  getCurrentSessionUserSync,
  isRecordVisibleToCurrentUser,
} from '../db/dexie';
import {
  allocateStockFEFO,
  classifyExpiryBucket,
  StockMovementType,
  SpeciesType,
} from '@baxnaano/shared';

export interface OfflineProductRecord {
  id: string;
  branchId: string;
  categoryId: string;
  unitId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  buyPriceUsd: number;
  sellPriceUsd: number;
  reorderLevel: number;
  // Pharmacy fields
  genericName?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  isPrescriptionOnly: boolean;
  // Vet fields
  targetSpecies: SpeciesType[];
  dosePerKg?: string | null;
  withdrawalPeriodDays?: number | null;
  isColdChainRequired: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OfflineBatchRecord {
  id: string;
  branchId: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  cachedQuantity: number;
  supplierId?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OfflineStockMovementRecord {
  id: string;
  branchId: string;
  productId: string;
  batchId: string;
  userId: string;
  type: StockMovementType;
  quantityDelta: number;
  unitCostUsd?: number;
  referenceId?: string;
  referenceType?: string;
  reason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OfflineStockTransferRecord {
  id: string;
  branchId: string;
  destinationBranchId: string;
  transferNumber: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  productId: string;
  productName: string;
  sku: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  buyPriceUsd: number;
  sellPriceUsd: number;
  notes?: string;
  initiatedById: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Recomputes the exact batch balance from the local IndexedDB `stockMovements` ledger
 * and updates `batches.cachedQuantity`.
 */
export async function recomputeLocalBatchLedgerBalance(
  branchId: string,
  batchId: string
): Promise<number> {
  const movements = await db.stockMovements
    .where('batchId')
    .equals(batchId)
    .filter((m) => m.branchId === branchId && !m.deletedAt)
    .toArray();

  const sum = movements
    .filter((m) => !m.deletedAt)
    .reduce((acc, m) => acc + Number(m.quantityDelta || 0), 0);

  const existingBatch = await db.batches.get(batchId);
  if (existingBatch) {
    await db.batches.update(batchId, {
      cachedQuantity: sum,
      updatedAt: new Date().toISOString(),
    });
  }

  return sum;
}

/**
 * Appends a StockMovement to local IndexedDB, updates the batch ledger sum,
 * and enqueues a `LEDGER_APPEND` sync item so the server appends the exact delta.
 */
export async function appendOfflineStockMovement(params: {
  branchId: string;
  productId: string;
  batchId: string;
  userId: string;
  type: StockMovementType;
  quantityDelta: number;
  unitCostUsd?: number;
  referenceId?: string;
  referenceType?: string;
  reason?: string;
}): Promise<{ movement: OfflineStockMovementRecord; newBatchQuantity: number }> {
  const now = new Date().toISOString();
  const movementId = uuidv4();

  const movement: OfflineStockMovementRecord = {
    id: movementId,
    branchId: params.branchId,
    productId: params.productId,
    batchId: params.batchId,
    userId: params.userId,
    type: params.type,
    quantityDelta: params.quantityDelta,
    unitCostUsd: params.unitCostUsd,
    referenceId: params.referenceId,
    referenceType: params.referenceType,
    reason: params.reason,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  let newBatchQuantity = 0;

  await db.transaction('rw', [db.stockMovements, db.batches, db.syncQueue], async () => {
    await db.stockMovements.put(
      movement as unknown as OfflineStockMovementRecord & Record<string, unknown>
    );
    newBatchQuantity = await recomputeLocalBatchLedgerBalance(params.branchId, params.batchId);

    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: params.branchId,
      entityType: 'StockMovement',
      entityId: movementId,
      operation: 'LEDGER_APPEND',
      payload: movement as unknown as Record<string, unknown>,
      baseVersion: 1,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });

  return { movement, newBatchQuantity };
}

/**
 * Offline Stock-In (Purchase receiving):
 * Creates/updates batches in IndexedDB, appends `PURCHASE` ledger movements,
 * and queues for background sync.
 */
export async function recordOfflinePurchaseStockIn(params: {
  branchId: string;
  supplierId: string;
  invoiceNumber: string;
  paidAmountUsd: number;
  userId: string;
  notes?: string;
  items: Array<{
    productId: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    buyPriceUsd: number;
    sellPriceUsd: number;
  }>;
}) {
  const now = new Date().toISOString();
  const purchaseId = uuidv4();

  await db.transaction(
    'rw',
    [db.products, db.batches, db.stockMovements, db.syncQueue],
    async () => {
      const processedItems = [];

      for (const item of params.items) {
        const existingBatches = await db.batches
          .where('productId')
          .equals(item.productId)
          .filter(
            (b) =>
              b.branchId === params.branchId &&
              b.batchNumber === item.batchNumber &&
              !b.deletedAt
          )
          .toArray();

        const batchId = existingBatches[0]?.id || uuidv4();
        const currentQty = existingBatches[0] ? Number(existingBatches[0].cachedQuantity || 0) : 0;

        const batchRecord: OfflineBatchRecord = {
          id: batchId,
          branchId: params.branchId,
          productId: item.productId,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
          cachedQuantity: currentQty + item.quantity,
          supplierId: params.supplierId,
          version: (existingBatches[0]?.version || 0) + 1,
          createdAt: existingBatches[0]?.createdAt || now,
          updatedAt: now,
          deletedAt: null,
        };

        await db.batches.put(
          batchRecord as unknown as OfflineBatchRecord & Record<string, unknown>
        );

        // Update product prices locally
        await db.products.update(item.productId, {
          buyPriceUsd: item.buyPriceUsd,
          sellPriceUsd: item.sellPriceUsd,
          updatedAt: now,
        });

        const movementId = uuidv4();
        const movement: OfflineStockMovementRecord = {
          id: movementId,
          branchId: params.branchId,
          productId: item.productId,
          batchId,
          userId: params.userId,
          type: 'PURCHASE',
          quantityDelta: item.quantity,
          unitCostUsd: item.buyPriceUsd,
          referenceId: purchaseId,
          referenceType: 'PURCHASE',
          reason: `Purchase Invoice #${params.invoiceNumber}`,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        await db.stockMovements.put(
          movement as unknown as OfflineStockMovementRecord & Record<string, unknown>
        );
        await recomputeLocalBatchLedgerBalance(params.branchId, batchId);

        processedItems.push({ ...item, batchId });
      }

      // Queue whole atomic purchase payload for server sync
      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: params.branchId,
        entityType: 'Purchase',
        entityId: purchaseId,
        operation: 'CREATE',
        payload: {
          id: purchaseId,
          branchId: params.branchId,
          supplierId: params.supplierId,
          invoiceNumber: params.invoiceNumber,
          paidAmountUsd: params.paidAmountUsd,
          notes: params.notes,
          items: processedItems,
        },
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });
    }
  );

  return purchaseId;
}

/**
 * Inter-Branch Stock Transfer (B1 <-> B2 <-> B3):
 * Deducts `TRANSFER_OUT` from source branch batch ledger, creates/updates product & batch
 * in destination branch, appends `TRANSFER_IN` to destination branch ledger, and records transfer.
 */
export async function createOfflineStockTransfer(params: {
  sourceBranchId: string;
  destinationBranchId: string;
  productId: string;
  batchId: string;
  quantity: number;
  notes?: string;
  userId: string;
}): Promise<OfflineStockTransferRecord> {
  if (params.sourceBranchId === params.destinationBranchId) {
    throw new Error('Source and destination branches must be different');
  }

  const now = new Date().toISOString();
  const transferId = uuidv4();
  const transferNumber = `TRF-${Date.now().toString().slice(-6)}`;

  let createdTransfer!: OfflineStockTransferRecord;

  await db.transaction(
    'rw',
    [db.products, db.batches, db.stockMovements, db.transfers, db.syncQueue],
    async () => {
      const sourceProduct = await db.products.get(params.productId);
      const sourceBatch = await db.batches.get(params.batchId);

      if (!sourceProduct || !sourceBatch) {
        throw new Error('Source product or batch not found');
      }

      const available = Number(sourceBatch.cachedQuantity || 0);
      if (params.quantity <= 0 || params.quantity > available) {
        throw new Error(`Insufficient batch stock (Available: ${available})`);
      }

      // 1. Deduct from source branch via TRANSFER_OUT movement
      const outMoveId = uuidv4();
      await db.stockMovements.put({
        id: outMoveId,
        branchId: params.sourceBranchId,
        productId: sourceProduct.id,
        batchId: sourceBatch.id,
        userId: params.userId,
        type: 'TRANSFER_OUT',
        quantityDelta: -Math.abs(params.quantity),
        unitCostUsd: Number(sourceBatch.buyPriceUsd || 0),
        referenceId: transferId,
        referenceType: 'TRANSFER',
        reason: `Transfer Out #${transferNumber} to ${params.destinationBranchId}`,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await recomputeLocalBatchLedgerBalance(params.sourceBranchId, sourceBatch.id);

      // 2. Find or create matching Product in destination branch by SKU
      const destProducts = await db.products
        .where('branchId')
        .equals(params.destinationBranchId)
        .filter((p) => p.sku === sourceProduct.sku && !p.deletedAt)
        .toArray();

      let destProductId = destProducts[0]?.id;
      if (!destProductId) {
        destProductId = uuidv4();
        await db.products.put({
          ...sourceProduct,
          id: destProductId,
          branchId: params.destinationBranchId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      // 3. Find or create matching ProductBatch in destination branch
      const destBatches = await db.batches
        .where('productId')
        .equals(destProductId)
        .filter(
          (b) =>
            b.branchId === params.destinationBranchId &&
            b.batchNumber === sourceBatch.batchNumber &&
            !b.deletedAt
        )
        .toArray();

      let destBatchId = destBatches[0]?.id;
      if (!destBatchId) {
        destBatchId = uuidv4();
        await db.batches.put({
          id: destBatchId,
          branchId: params.destinationBranchId,
          productId: destProductId,
          batchNumber: String(sourceBatch.batchNumber),
          expiryDate: String(sourceBatch.expiryDate),
          buyPriceUsd: Number(sourceBatch.buyPriceUsd || 0),
          sellPriceUsd: Number(sourceBatch.sellPriceUsd || 0),
          cachedQuantity: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      // 4. Append TRANSFER_IN movement to destination branch
      const inMoveId = uuidv4();
      await db.stockMovements.put({
        id: inMoveId,
        branchId: params.destinationBranchId,
        productId: destProductId,
        batchId: destBatchId,
        userId: params.userId,
        type: 'TRANSFER_IN',
        quantityDelta: Math.abs(params.quantity),
        unitCostUsd: Number(sourceBatch.buyPriceUsd || 0),
        referenceId: transferId,
        referenceType: 'TRANSFER',
        reason: `Transfer In #${transferNumber} from ${params.sourceBranchId}`,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await recomputeLocalBatchLedgerBalance(params.destinationBranchId, destBatchId);

      // 5. Save Transfer Record
      createdTransfer = {
        id: transferId,
        branchId: params.sourceBranchId,
        destinationBranchId: params.destinationBranchId,
        transferNumber,
        status: 'COMPLETED',
        productId: sourceProduct.id,
        productName: String(sourceProduct.name),
        sku: String(sourceProduct.sku),
        batchId: sourceBatch.id,
        batchNumber: String(sourceBatch.batchNumber),
        expiryDate: String(sourceBatch.expiryDate),
        quantity: params.quantity,
        buyPriceUsd: Number(sourceBatch.buyPriceUsd || 0),
        sellPriceUsd: Number(sourceBatch.sellPriceUsd || 0),
        notes: params.notes,
        initiatedById: params.userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      await db.transfers.put(
        createdTransfer as unknown as OfflineStockTransferRecord & Record<string, unknown>
      );

      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: params.sourceBranchId,
        entityType: 'StockTransfer',
        entityId: transferId,
        operation: 'CREATE',
        payload: createdTransfer as unknown as Record<string, unknown>,
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: now,
      });
    }
  );

  return createdTransfer;
}

export async function getOfflineStockTransfers(
  branchId: string
): Promise<OfflineStockTransferRecord[]> {
  const sessionUser = getCurrentSessionUserSync();
  const effectiveBranchId =
    sessionUser && sessionUser.role !== 'ADMIN' && sessionUser.branchId
      ? sessionUser.branchId
      : branchId;

  const all = await db.transfers.filter((t) => !t.deletedAt).toArray();
  const filtered = (
    effectiveBranchId === 'ALL'
      ? all
      : all.filter((t) =>
          sessionUser?.role === 'VET_OFFICER'
            ? t.branchId === effectiveBranchId
            : t.branchId === effectiveBranchId || t.destinationBranchId === effectiveBranchId
        )
  ).filter((t) =>
    isRecordVisibleToCurrentUser(t, ['initiatedById', 'receivedById', 'createdById'])
  );

  return (filtered as unknown as OfflineStockTransferRecord[]).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getOfflineStockMovements(branchId: string) {
  const sessionUser = getCurrentSessionUserSync();
  const effectiveBranchId =
    sessionUser && sessionUser.role !== 'ADMIN' && sessionUser.branchId
      ? sessionUser.branchId
      : branchId;

  const rawMovements =
    effectiveBranchId === 'ALL'
      ? await db.stockMovements.filter((m) => !m.deletedAt).toArray()
      : await db.stockMovements
          .where('branchId')
          .equals(effectiveBranchId)
          .filter((m) => !m.deletedAt)
          .toArray();

  const movements = rawMovements.filter((m) =>
    isRecordVisibleToCurrentUser(m, ['userId', 'createdById'])
  );

  const products = await db.products.toArray();
  const batches = await db.batches.toArray();

  const prodMap = new Map(products.map((p) => [p.id, p]));
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  return movements
    .map((m) => {
      const prod = prodMap.get(String(m.productId));
      const batch = batchMap.get(String(m.batchId));
      return {
        id: String(m.id),
        branchId: String(m.branchId),
        productId: String(m.productId),
        productName: prod ? String(prod.name) : String(m.productId),
        sku: prod ? String(prod.sku) : '',
        batchId: String(m.batchId),
        batchNumber: batch ? String(batch.batchNumber) : String(m.batchId),
        type: String(m.type) as StockMovementType,
        quantityDelta: Number(m.quantityDelta || 0),
        reason: String(m.reason || ''),
        referenceType: String(m.referenceType || ''),
        createdAt: String(m.createdAt),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Offline Stock-Take Reconciliation:
 * Compares physical counts against local ledger balance, writes `STOCK_TAKE_VARIANCE`
 * movements for any discrepancy, and returns the variance report immediately offline.
 */
export async function performOfflineStockTake(params: {
  branchId: string;
  userId: string;
  reason: string;
  entries: Array<{
    productId: string;
    batchId: string;
    physicalCount: number;
  }>;
}) {
  const stockTakeId = uuidv4();
  const varianceReport: Array<{
    productId: string;
    productName: string;
    sku: string;
    batchId: string;
    batchNumber: string;
    systemQuantity: number;
    physicalCount: number;
    variance: number;
    varianceValueUsd: number;
  }> = [];

  for (const entry of params.entries) {
    const product = await db.products.get(entry.productId);
    const batch = await db.batches.get(entry.batchId);
    if (!product || !batch) continue;

    const systemQuantity = await recomputeLocalBatchLedgerBalance(
      params.branchId,
      entry.batchId
    );
    const variance = entry.physicalCount - systemQuantity;

    if (variance !== 0) {
      await appendOfflineStockMovement({
        branchId: params.branchId,
        productId: entry.productId,
        batchId: entry.batchId,
        userId: params.userId,
        type: 'STOCK_TAKE_VARIANCE',
        quantityDelta: variance,
        unitCostUsd: Number(batch.buyPriceUsd || 0),
        referenceId: stockTakeId,
        referenceType: 'STOCK_TAKE',
        reason: `${params.reason} (System: ${systemQuantity}, Counted: ${entry.physicalCount})`,
      });
    }

    varianceReport.push({
      productId: entry.productId,
      productName: String(product.name),
      sku: String(product.sku),
      batchId: entry.batchId,
      batchNumber: String(batch.batchNumber),
      systemQuantity,
      physicalCount: entry.physicalCount,
      variance,
      varianceValueUsd: Number((variance * Number(batch.buyPriceUsd || 0)).toFixed(2)),
    });
  }

  return { stockTakeId, varianceReport };
}

/**
 * Offline FEFO Helper for POS & Inventory:
 * Returns enriched products with their non-expired sellable stock, expired stock,
 * and FEFO batch order.
 */
export async function getOfflineProductsWithFEFO(branchId: string) {
  const sessionUser = getCurrentSessionUserSync();
  const effectiveBranchId =
    sessionUser && sessionUser.role !== 'ADMIN' && sessionUser.branchId
      ? sessionUser.branchId
      : branchId;

  const rawProducts =
    effectiveBranchId === 'ALL'
      ? await db.products.filter((p) => !p.deletedAt).toArray()
      : await db.products
          .where('branchId')
          .equals(effectiveBranchId)
          .filter((p) => !p.deletedAt)
          .toArray();

  const rawBatches =
    effectiveBranchId === 'ALL'
      ? await db.batches.filter((b) => !b.deletedAt).toArray()
      : await db.batches
          .where('branchId')
          .equals(effectiveBranchId)
          .filter((b) => !b.deletedAt)
          .toArray();

  const products = rawProducts.filter((p) => isRecordVisibleToCurrentUser(p));
  const batches = rawBatches.filter((b) => isRecordVisibleToCurrentUser(b));

  return products.map((p) => {
    const productBatches = batches
      .filter((b) => b.productId === p.id)
      .sort(
        (a, b) =>
          new Date(String(a.expiryDate)).getTime() -
          new Date(String(b.expiryDate)).getTime()
      );

    let sellableStock = 0;
    let expiredStock = 0;
    let earliestExpiry: string | null = null;

    const enrichedBatches = productBatches.map((b) => {
      const qty = Number(b.cachedQuantity || 0);
      const { bucket, daysUntilExpiry } = classifyExpiryBucket(String(b.expiryDate));
      if (bucket === 'EXPIRED') {
        expiredStock += Math.max(0, qty);
      } else if (qty > 0) {
        sellableStock += qty;
        if (!earliestExpiry || new Date(String(b.expiryDate)) < new Date(earliestExpiry)) {
          earliestExpiry = String(b.expiryDate);
        }
      }
      return {
        ...(b as unknown as OfflineBatchRecord),
        cachedQuantity: qty,
        expiryBucket: bucket,
        daysUntilExpiry,
      };
    });

    const fefoPreview = allocateStockFEFO(
      enrichedBatches.map((b) => ({
        id: b.id,
        batchNumber: String(b.batchNumber),
        expiryDate: String(b.expiryDate),
        availableQuantity: b.cachedQuantity,
        buyPriceUsd: Number(b.buyPriceUsd),
        sellPriceUsd: Number(b.sellPriceUsd),
      })),
      1
    );

    return {
      ...(p as unknown as OfflineProductRecord),
      batches: enrichedBatches,
      sellableStock,
      expiredStock,
      isLowStock: sellableStock <= Number(p.reorderLevel || 10),
      earliestExpiry,
      nextFefoBatch: fefoPreview.allocations[0] || null,
    };
  });
}

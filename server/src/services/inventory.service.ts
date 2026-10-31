import { Prisma, StockMovementType } from '@prisma/client';
import { prisma } from '../config/db';
import { allocateStockFEFO, FEFOAllocationResult } from '@baxnaano/shared';

/**
 * Computes the true ledger balance of a specific ProductBatch by summing all
 * non-deleted StockMovement.quantityDelta entries, and synchronizes cachedQuantity.
 *
 * RULE: Stock is NEVER arbitrarily overwritten; it is always derived from the
 * immutable movement ledger.
 */
export async function recalculateBatchBalanceFromLedger(
  tx: Prisma.TransactionClient,
  branchId: string,
  batchId: string
): Promise<number> {
  const aggregation = await tx.stockMovement.aggregate({
    where: {
      branchId,
      batchId,
      deletedAt: null,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  const ledgerSum = aggregation._sum.quantityDelta ?? 0;

  await tx.productBatch.update({
    where: { id: batchId },
    data: {
      cachedQuantity: ledgerSum,
      version: { increment: 1 },
    },
  });

  return ledgerSum;
}

/**
 * Appends a single StockMovement entry inside a Prisma transaction and updates
 * the batch's cachedQuantity from the true ledger sum.
 * Idempotent by movement `id` (if client retries same movement UUID across disconnects, returns existing).
 */
export async function appendStockMovement(
  tx: Prisma.TransactionClient,
  params: {
    id?: string;
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
  }
) {
  if (params.id) {
    const existing = await tx.stockMovement.findUnique({ where: { id: params.id } });
    if (existing) {
      const currentQty = await recalculateBatchBalanceFromLedger(tx, params.branchId, params.batchId);
      return { movement: existing, newBatchQuantity: currentQty, idempotentReplay: true };
    }
  }

  // Verify batch belongs to branch & product
  const batch = await tx.productBatch.findFirst({
    where: {
      id: params.batchId,
      branchId: params.branchId,
      productId: params.productId,
      deletedAt: null,
    },
  });

  if (!batch) {
    throw new Error('BATCH_NOT_FOUND_IN_BRANCH');
  }

  // Before deducting, strictly verify sufficient batch stock from authoritative ledger
  if (params.quantityDelta < 0) {
    const currentLedgerQty = await recalculateBatchBalanceFromLedger(
      tx,
      params.branchId,
      params.batchId
    );
    if (currentLedgerQty + params.quantityDelta < 0) {
      throw new Error(`INSUFFICIENT_BATCH_STOCK:${batch.batchNumber}:available=${currentLedgerQty}`);
    }
  }

  const movement = await tx.stockMovement.create({
    data: {
      id: params.id,
      branchId: params.branchId,
      productId: params.productId,
      batchId: params.batchId,
      userId: params.userId,
      type: params.type,
      quantityDelta: params.quantityDelta,
      unitCostUsd: params.unitCostUsd ?? batch.buyPriceUsd,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      reason: params.reason,
    },
  });

  const newBatchQuantity = await recalculateBatchBalanceFromLedger(
    tx,
    params.branchId,
    params.batchId
  );

  return { movement, newBatchQuantity, idempotentReplay: false };
}

/**
 * Server-side FEFO (First Expiry, First Out) allocator for a Product in a Branch.
 * Queries all active batches and computes their true ledger quantities before running FEFO.
 */
export async function getProductFEFOAllocation(
  tx: Prisma.TransactionClient,
  branchId: string,
  productId: string,
  requestedQuantity: number
): Promise<FEFOAllocationResult> {
  const batches = await tx.productBatch.findMany({
    where: {
      branchId,
      productId,
      deletedAt: null,
    },
    orderBy: { expiryDate: 'asc' },
  });

  // Compute ledger sum per batch
  const ledgerSums = await tx.stockMovement.groupBy({
    by: ['batchId'],
    where: {
      branchId,
      productId,
      deletedAt: null,
    },
    _sum: {
      quantityDelta: true,
    },
  });

  const sumMap = new Map<string, number>();
  for (const row of ledgerSums) {
    sumMap.set(row.batchId, row._sum.quantityDelta ?? 0);
  }

  const candidates = batches.map((b) => ({
    id: b.id,
    batchNumber: b.batchNumber,
    expiryDate: b.expiryDate,
    availableQuantity: sumMap.get(b.id) ?? 0,
    buyPriceUsd: Number(b.buyPriceUsd),
    sellPriceUsd: Number(b.sellPriceUsd),
  }));

  return allocateStockFEFO(candidates, requestedQuantity);
}

/**
 * Returns total stock across all valid (non-expired) vs expired batches for a product
 */
export async function getProductStockSummary(branchId: string | null) {
  const whereBranch = branchId ? { branchId, deletedAt: null } : { deletedAt: null };

  const batches = await prisma.productBatch.findMany({
    where: whereBranch,
    include: {
      product: {
        include: { category: true, unit: true },
      },
      branch: true,
    },
    orderBy: { expiryDate: 'asc' },
  });

  return batches;
}

// ============================================================================
// BAXNAANO SHARED INVENTORY, BATCH, PURCHASE, TRANSFER & FEFO SCHEMAS
// ============================================================================

import { z } from 'zod';

export const SPECIES_ENUM = [
  'HUMAN',
  'CAMEL',
  'CATTLE',
  'SHEEP',
  'GOAT',
  'POULTRY',
  'OTHER',
] as const;

export type SpeciesType = (typeof SPECIES_ENUM)[number];

export const STOCK_MOVEMENT_TYPES = [
  'INITIAL_STOCK',
  'PURCHASE',
  'SALE',
  'VOID_REVERSAL',
  'REFUND_RETURN',
  'ADJUSTMENT_PLUS',
  'ADJUSTMENT_MINUS',
  'DAMAGE_EXPIRED',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'STOCK_TAKE_VARIANCE',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const CategorySchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  name: z.string().min(2).max(80),
  nameSo: z.string().max(80).optional().nullable(),
  description: z.string().max(255).optional().nullable(),
});

export const UnitSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  name: z.string().min(1).max(50),
  abbreviation: z.string().min(1).max(15),
});

export const SupplierSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  contactPerson: z.string().max(100).optional().nullable(),
  phone: z.string().min(6).max(30),
  email: z.string().email().optional().nullable(),
  address: z.string().max(255).optional().nullable(),
});

export const ProductSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  categoryId: z.string().uuid(),
  unitId: z.string().uuid(),
  sku: z.string().min(2).max(50),
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().min(2).max(150),
  description: z.string().max(500).optional().nullable(),
  buyPriceUsd: z.coerce.number().nonnegative(),
  sellPriceUsd: z.coerce.number().positive(),
  reorderLevel: z.coerce.number().int().nonnegative().default(10),

  // Pharmacy Specific (B1 - Human Health)
  genericName: z.string().max(150).optional().nullable(),
  dosageForm: z.string().max(60).optional().nullable(),
  strength: z.string().max(60).optional().nullable(),
  isPrescriptionOnly: z.boolean().default(false),

  // Veterinary Specific (B2, B3 - Livestock Health)
  targetSpecies: z.array(z.enum(SPECIES_ENUM)).default([]),
  dosePerKg: z.string().max(80).optional().nullable(),
  withdrawalPeriodDays: z.coerce.number().int().nonnegative().optional().nullable(),
  isColdChainRequired: z.boolean().default(false),
});

export const PurchaseItemInputSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  batchNumber: z.string().min(1).max(60),
  expiryDate: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid expiry date',
  }),
  manufacturingDate: z.string().optional().nullable(),
  quantity: z.coerce.number().int().positive(),
  buyPriceUsd: z.coerce.number().nonnegative(),
  sellPriceUsd: z.coerce.number().positive(),
});

export const CreatePurchaseSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  supplierId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(60),
  purchaseDate: z.string().optional(),
  paidAmountUsd: z.coerce.number().nonnegative().default(0),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(PurchaseItemInputSchema).min(1),
});

export const StockAdjustmentSchema = z.object({
  id: z.string().uuid().optional(), // StockMovement ID (client UUID for idempotency)
  branchId: z.string().min(1),
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  type: z.enum(['ADJUSTMENT_PLUS', 'ADJUSTMENT_MINUS', 'DAMAGE_EXPIRED']),
  quantity: z.coerce.number().int().positive(), // Positive integer; sign derived from type
  reason: z.string().min(3).max(300),
});

export const StockTakeEntrySchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid(),
  physicalCount: z.coerce.number().int().nonnegative(),
  notes: z.string().max(255).optional().nullable(),
});

export const StockTakeSubmissionSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  reason: z.string().min(3).max(300).default('Periodic Physical Stock Take'),
  entries: z.array(StockTakeEntrySchema).min(1),
});

export const TransferItemSchema = z.object({
  productId: z.string().uuid(),
  sku: z.string().min(1),
  productName: z.string().min(1),
  sourceBatchId: z.string().uuid(),
  batchNumber: z.string().min(1),
  expiryDate: z.string(),
  quantity: z.coerce.number().int().positive(),
  buyPriceUsd: z.coerce.number().nonnegative(),
  sellPriceUsd: z.coerce.number().positive(),
});

export const CreateTransferSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1), // Source branch
  destinationBranchId: z.string().min(1),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(TransferItemSchema).min(1),
});

// ----------------------------------------------------------------------------
// PURE FEFO (FIRST EXPIRY, FIRST OUT) ALLOCATION & EXPIRY ENGINE
// Shared between Client POS/Inventory and Server Transaction Engine
// ----------------------------------------------------------------------------

export interface BatchCandidate {
  id: string;
  batchNumber: string;
  expiryDate: string | Date;
  availableQuantity: number;
  buyPriceUsd: number;
  sellPriceUsd: number;
}

export interface FEFOAllocationItem {
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  allocatedQuantity: number;
  unitBuyPriceUsd: number;
  unitSellPriceUsd: number;
}

export interface FEFOAllocationResult {
  success: boolean;
  allocations: FEFOAllocationItem[];
  shortfallQuantity: number;
  expiredBatchesSkipped: string[];
  errorCode?: 'EXPIRED_BATCHES_ONLY' | 'INSUFFICIENT_STOCK';
}

/**
 * Pure FEFO batch allocator:
 * 1. Strictly blocks any batch whose expiryDate < referenceDate (start of today).
 * 2. Sorts valid batches with availableQuantity > 0 by earliest expiryDate ascending.
 * 3. Allocates requestedQuantity across one or more batches in FEFO order.
 */
export function allocateStockFEFO(
  batches: BatchCandidate[],
  requestedQuantity: number,
  referenceDate: Date = new Date()
): FEFOAllocationResult {
  const startOfToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  ).getTime();

  const expiredBatchesSkipped: string[] = [];
  const validBatches: BatchCandidate[] = [];

  for (const b of batches) {
    if (b.availableQuantity <= 0) continue;
    const expTime = new Date(b.expiryDate).getTime();
    if (expTime < startOfToday) {
      expiredBatchesSkipped.push(b.batchNumber);
    } else {
      validBatches.push(b);
    }
  }

  // Sort by earliest expiry date first (FEFO)
  validBatches.sort(
    (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
  );

  let remainingToAllocate = requestedQuantity;
  const allocations: FEFOAllocationItem[] = [];

  for (const batch of validBatches) {
    if (remainingToAllocate <= 0) break;
    const take = Math.min(batch.availableQuantity, remainingToAllocate);
    if (take > 0) {
      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: new Date(batch.expiryDate).toISOString(),
        allocatedQuantity: take,
        unitBuyPriceUsd: Number(batch.buyPriceUsd),
        unitSellPriceUsd: Number(batch.sellPriceUsd),
      });
      remainingToAllocate -= take;
    }
  }

  if (remainingToAllocate > 0) {
    return {
      success: false,
      allocations,
      shortfallQuantity: remainingToAllocate,
      expiredBatchesSkipped,
      errorCode:
        validBatches.length === 0 && expiredBatchesSkipped.length > 0
          ? 'EXPIRED_BATCHES_ONLY'
          : 'INSUFFICIENT_STOCK',
    };
  }

  return {
    success: true,
    allocations,
    shortfallQuantity: 0,
    expiredBatchesSkipped,
  };
}

export type ExpiryBucket = 'EXPIRED' | 'DAYS_30' | 'DAYS_60' | 'DAYS_90' | 'SAFE';

export function classifyExpiryBucket(
  expiryDate: string | Date,
  referenceDate: Date = new Date()
): { bucket: ExpiryBucket; daysUntilExpiry: number } {
  const startOfToday = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  ).getTime();
  const expTime = new Date(expiryDate).getTime();
  const daysUntilExpiry = Math.ceil((expTime - startOfToday) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return { bucket: 'EXPIRED', daysUntilExpiry };
  if (daysUntilExpiry <= 30) return { bucket: 'DAYS_30', daysUntilExpiry };
  if (daysUntilExpiry <= 60) return { bucket: 'DAYS_60', daysUntilExpiry };
  if (daysUntilExpiry <= 90) return { bucket: 'DAYS_90', daysUntilExpiry };
  return { bucket: 'SAFE', daysUntilExpiry };
}

// ----------------------------------------------------------------------------
// RESPONSE SCHEMAS FOR CONTRACT INTEGRITY
// ----------------------------------------------------------------------------

export const BatchItemSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  productId: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  manufacturingDate: z.string().nullable().optional(),
  buyPriceUsd: z.number(),
  sellPriceUsd: z.number(),
  cachedQuantity: z.number(),
  expiryBucket: z.enum(['EXPIRED', 'DAYS_30', 'DAYS_60', 'DAYS_90', 'SAFE']),
  daysUntilExpiry: z.number(),
});
export type BatchItem = z.infer<typeof BatchItemSchema>;

export const ProductItemSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  categoryId: z.string(),
  unitId: z.string(),
  sku: z.string(),
  barcode: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  buyPriceUsd: z.number(),
  sellPriceUsd: z.number(),
  reorderLevel: z.number(),
  genericName: z.string().nullable().optional(),
  dosageForm: z.string().nullable().optional(),
  strength: z.string().nullable().optional(),
  isPrescriptionOnly: z.boolean(),
  targetSpecies: z.array(z.string()).default([]),
  dosePerKg: z.string().nullable().optional(),
  withdrawalPeriodDays: z.number().nullable().optional(),
  isColdChainRequired: z.boolean(),
  batches: z.array(BatchItemSchema).default([]),
  sellableStock: z.number(),
  expiredStock: z.number(),
  totalStock: z.number(),
  isLowStock: z.boolean(),
  earliestExpiry: z.string().nullable().optional(),
  nextFefoBatch: z
    .object({
      batchNumber: z.string(),
      expiryDate: z.string(),
    })
    .nullable()
    .optional(),
  category: z.object({ id: z.string(), name: z.string() }).optional(),
  unit: z.object({ id: z.string(), name: z.string(), abbreviation: z.string() }).optional(),
});
export type ProductItem = z.infer<typeof ProductItemSchema>;


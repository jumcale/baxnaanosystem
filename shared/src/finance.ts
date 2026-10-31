// ============================================================================
// BAXNAANO SHARED PHASE 4 SCHEMAS:
// CREDIT RECORDS (DAYMAHA), EXPENSES (KHARASHYADA),
// QUOTATIONS (QIIMEYN), & SALES HISTORY VOID/REFUND
// ============================================================================

import { z } from 'zod';
import { CURRENCIES, PAYMENT_METHODS } from './sales';
import { SPECIES_ENUM } from './inventory';

// ----------------------------------------------------------------------------
// 1. CUSTOMERS & CREDIT LEDGER (DAYMAHA) + AGING CALCULATOR
// ----------------------------------------------------------------------------

export const CreateCustomerSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(30),
  address: z.string().max(255).optional().nullable(),
  villageOrFarm: z.string().max(120).optional().nullable(),
  primarySpecies: z.array(z.enum(SPECIES_ENUM)).default([]),
  herdSizeEstimate: z.coerce.number().int().nonnegative().optional().nullable(),
  creditLimitUsd: z.coerce.number().nonnegative().default(100),
});

export const CreditRepaymentSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  customerId: z.string().uuid(),
  method: z.enum(['CASH', 'EVC_PLUS', 'ZAAD', 'EDAHAB']),
  currency: z.enum(CURRENCIES).default('USD'),
  amountOriginal: z.coerce.number().positive(),
  exchangeRateUsed: z.coerce.number().positive(),
  referencePhone: z.string().max(30).optional().nullable(),
  transactionRef: z.string().max(80).optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

export interface CreditEntryForAging {
  id: string;
  type: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'VOID_REVERSAL';
  amountDeltaUsd: number;
  createdAt: string | Date;
  dueDate?: string | Date | null;
}

export interface CreditAgingSummary {
  totalBalanceUsd: number;
  bucket0to30Usd: number;
  bucket31to60Usd: number;
  bucket60PlusUsd: number;
  isOverdue: boolean;
}

/**
 * FIFO Credit Aging Calculator (0-30 days, 31-60 days, 60+ days)
 * Applies payments/reversals against oldest charges first (FIFO) and buckets
 * any remaining unpaid charge balances by age in days since charge creation.
 */
export function computeCustomerCreditAging(
  entries: CreditEntryForAging[],
  referenceDate: Date = new Date()
): CreditAgingSummary {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const openCharges: Array<{ remainingUsd: number; createdAt: Date; dueDate: Date | null }> = [];
  let totalCreditsToApply = 0;

  for (const entry of sorted) {
    const delta = Number(entry.amountDeltaUsd || 0);
    if (delta > 0) {
      openCharges.push({
        remainingUsd: delta,
        createdAt: new Date(entry.createdAt),
        dueDate: entry.dueDate ? new Date(entry.dueDate) : null,
      });
    } else if (delta < 0) {
      totalCreditsToApply += Math.abs(delta);
    }
  }

  // Apply repayments to oldest charges first (FIFO)
  for (const charge of openCharges) {
    if (totalCreditsToApply <= 0) break;
    const deduct = Math.min(charge.remainingUsd, totalCreditsToApply);
    charge.remainingUsd = Number((charge.remainingUsd - deduct).toFixed(2));
    totalCreditsToApply = Number((totalCreditsToApply - deduct).toFixed(2));
  }

  let bucket0to30Usd = 0;
  let bucket31to60Usd = 0;
  let bucket60PlusUsd = 0;
  let isOverdue = false;

  const refTime = referenceDate.getTime();

  for (const charge of openCharges) {
    if (charge.remainingUsd <= 0.009) continue;
    const ageDays = Math.floor((refTime - charge.createdAt.getTime()) / (1000 * 60 * 60 * 24));
    if (charge.dueDate && charge.dueDate.getTime() < refTime) {
      isOverdue = true;
    } else if (ageDays > 30) {
      isOverdue = true;
    }

    if (ageDays <= 30) {
      bucket0to30Usd = Number((bucket0to30Usd + charge.remainingUsd).toFixed(2));
    } else if (ageDays <= 60) {
      bucket31to60Usd = Number((bucket31to60Usd + charge.remainingUsd).toFixed(2));
    } else {
      bucket60PlusUsd = Number((bucket60PlusUsd + charge.remainingUsd).toFixed(2));
    }
  }

  const totalBalanceUsd = Number(
    (bucket0to30Usd + bucket31to60Usd + bucket60PlusUsd).toFixed(2)
  );

  return {
    totalBalanceUsd,
    bucket0to30Usd,
    bucket31to60Usd,
    bucket60PlusUsd,
    isOverdue,
  };
}

// ----------------------------------------------------------------------------
// 2. EXPENSES (KHARASHYADA)
// ----------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'RENT',
  'UTILITIES',
  'COLD_CHAIN_ICE_POWER',
  'VET_FIELD_FUEL_TRANSPORT',
  'SALARIES',
  'SUPPLIES',
  'MAINTENANCE',
  'OTHER',
] as const;

export const CreateExpenseSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  category: z.string().min(2).max(80),
  currencyPaid: z.enum(CURRENCIES).default('USD'),
  amountOriginal: z.coerce.number().positive(),
  exchangeRateUsed: z.coerce.number().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('CASH'),
  payee: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  receiptPhotoData: z.string().optional().nullable(), // Base64 receipt photo
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']).optional().nullable(),
  expenseDate: z.string().optional(),
});

export const ApproveExpenseSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(300).optional().nullable(),
});

// ----------------------------------------------------------------------------
// 3. QUOTATIONS (QIIMEYN)
// ----------------------------------------------------------------------------

export const QuotationItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  unitPriceUsd: z.coerce.number().positive(),
  discountUsd: z.coerce.number().nonnegative().default(0),
});

export const CreateQuotationSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().min(1),
  quotationNumber: z.string().optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerName: z.string().max(120).optional().nullable(),
  customerPhone: z.string().max(30).optional().nullable(),
  currency: z.enum(CURRENCIES).default('USD'),
  exchangeRateUsed: z.coerce.number().positive(),
  discountUsd: z.coerce.number().nonnegative().default(0),
  validUntil: z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Invalid expiry date',
  }),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(QuotationItemInputSchema).min(1),
});

// ----------------------------------------------------------------------------
// 4. SALES HISTORY VOID & REFUND SCHEMAS
// ----------------------------------------------------------------------------

export const VoidSaleSchema = z.object({
  reason: z.string().min(4).max(300),
  approvedById: z.string().uuid().optional().nullable(),
});

export const RefundSaleSchema = z.object({
  reason: z.string().min(4).max(300),
  approvedById: z.string().uuid().optional().nullable(),
  items: z
    .array(
      z.object({
        saleItemId: z.string().uuid(),
        quantityToRefund: z.coerce.number().int().positive(),
      })
    )
    .min(1),
});

// ----------------------------------------------------------------------------
// 5. RESPONSE SCHEMAS FOR CONTRACT INTEGRITY
// ----------------------------------------------------------------------------

export const ExpenseRecordSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  category: z.string(),
  amountUsd: z.number(),
  amountOriginal: z.number().optional(),
  currencyPaid: z.enum(['USD', 'SLSH']).optional(),
  currency: z.enum(['USD', 'SLSH']).optional(),
  exchangeRateUsed: z.number(),
  paymentMethod: z.string().optional(),
  payee: z.string().optional(),
  description: z.string().nullable().optional(),
  receiptNumber: z.string().nullable().optional(),
  receiptPhotoData: z.string().nullable().optional(),
  recordedById: z.string().optional(),
  recordedBy: z.object({ id: z.string(), fullName: z.string() }).optional(),
  approvedById: z.string().nullable().optional(),
  approvedBy: z.object({ id: z.string(), fullName: z.string() }).optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  expenseDate: z.string(),
  createdAt: z.string(),
});
export type ExpenseRecord = z.infer<typeof ExpenseRecordSchema>;

export const CustomerAgingBucketSchema = z.object({
  totalBalanceUsd: z.number(),
  bucket0to30Usd: z.number(),
  bucket31to60Usd: z.number(),
  bucket60PlusUsd: z.number(),
  overdueCount: z.number().optional(),
  isOverdue: z.boolean().optional(),
});

export const CustomerAgingSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  name: z.string(),
  phone: z.string(),
  villageOrFarm: z.string().nullable().optional(),
  creditLimitUsd: z.number(),
  currentBalanceUsd: z.number(),
  aging: CustomerAgingBucketSchema,
  entries: z.array(z.any()).default([]),
  creditEntries: z.array(z.any()).default([]),
  isOverLimit: z.boolean().optional(),
});
export type CustomerAging = z.infer<typeof CustomerAgingSchema>;


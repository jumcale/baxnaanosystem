// ============================================================================
// BAXNAANO SHARED POS, MULTI-CURRENCY, SPLIT PAYMENTS & RECEIPT SCHEMAS
// ============================================================================

import { z } from 'zod';

export const PAYMENT_METHODS = [
  'CASH',
  'EVC_PLUS',
  'ZAAD',
  'EDAHAB',
  'CREDIT',
] as const;

export type PaymentMethodType = (typeof PAYMENT_METHODS)[number];

export const CURRENCIES = ['USD', 'SLSH'] as const;
export type CurrencyType = (typeof CURRENCIES)[number];

/**
 * Multi-Currency Conversion Helpers
 * - USD is the canonical accounting base currency (4 decimal precision for unit items, 2 for totals).
 * - SLSH is rounded to the nearest 100 Shillings (or exact integer) per Somaliland market standard.
 */
export function usdToSlsh(amountUsd: number, exchangeRate: number): number {
  return Math.round(amountUsd * exchangeRate);
}

export function slshToUsd(amountSlsh: number, exchangeRate: number): number {
  if (exchangeRate <= 0) return 0;
  return Number((amountSlsh / exchangeRate).toFixed(4));
}

export function normalizePaymentToUsd(
  amountOriginal: number,
  currency: CurrencyType,
  exchangeRate: number
): number {
  if (currency === 'USD') {
    return Number(amountOriginal.toFixed(2));
  }
  return Number((amountOriginal / exchangeRate).toFixed(2));
}

export const SaleCartItemInputSchema = z.object({
  id: z.string().min(1).optional(),
  productId: z.string().min(1),
  productName: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  /** Optional explicit batchId; if omitted, server/client auto-allocates via FEFO */
  batchId: z.string().min(1).optional(),
  batchNumber: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  unitBuyPriceUsd: z.coerce.number().nonnegative().optional(),
  quantity: z.coerce.number().int().positive(),
  unitPriceUsd: z.coerce.number().positive(),
  discountUsd: z.coerce.number().nonnegative().default(0),
  dosageNote: z.string().max(255).optional().nullable(),
});

export const SalePaymentInputSchema = z.object({
  id: z.string().min(1).optional(),
  method: z.enum(PAYMENT_METHODS),
  currency: z.enum(CURRENCIES).default('USD'),
  amountOriginal: z.coerce.number().positive(),
  referencePhone: z.string().max(30).optional().nullable(),
  transactionRef: z.string().max(80).optional().nullable(),
});

export const CreateSaleSchema = z.object({
  id: z.string().min(1).optional(),
  branchId: z.string().min(1),
  receiptNumber: z.string().min(3).max(60).optional(),
  customerId: z.string().min(1).optional().nullable(),
  customerName: z.string().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  currency: z.enum(CURRENCIES).default('USD'),
  exchangeRateUsed: z.coerce.number().positive(),
  discountUsd: z.coerce.number().nonnegative().default(0),
  taxUsd: z.coerce.number().nonnegative().default(0),
  approvedById: z.string().min(1).optional().nullable(),
  prescriptionRef: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  dueDate: z.string().optional().nullable(), // If credit payment is included
  soldAt: z.string().optional(),
  items: z.array(SaleCartItemInputSchema).min(1),
  payments: z.array(SalePaymentInputSchema).min(1),
});

export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;
export type SaleCartItemInput = z.infer<typeof SaleCartItemInputSchema>;
export type SalePaymentInput = z.infer<typeof SalePaymentInputSchema>;

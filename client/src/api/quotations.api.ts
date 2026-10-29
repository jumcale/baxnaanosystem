/**
 * Baxnaano Online-Only Quotations API Client
 * - Authoritative direct API for quotation drafting, price estimates, and sales conversion.
 */

import { apiRequest } from './client';
import { ReceiptData, formatServerSaleToReceipt, salesApi } from './sales.api';

export interface QuotationItem {
  id: string;
  quotationId: string;
  productId: string;
  product?: { id: string; name: string; sku: string };
  quantity: number;
  unitPriceUsd: number;
  discountUsd: number;
  subtotalUsd: number;
}

export interface QuotationRecord {
  id: string;
  branchId: string;
  quotationNumber: string;
  customerName: string;
  customerPhone?: string | null;
  currency: 'USD' | 'SLSH';
  exchangeRateUsed: number;
  subtotalUsd: number;
  discountUsd: number;
  taxUsd: number;
  totalUsd: number;
  totalSlsh: number;
  status: 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'REJECTED' | 'CONVERTED_TO_SALE' | 'EXPIRED';
  validUntil: string;
  notes?: string | null;
  items: QuotationItem[];
  createdAt: string;
}

export const quotationsApi = {
  /**
   * Fetch quotations
   */
  async getQuotations(branchIdOrStatus?: string): Promise<QuotationRecord[]> {
    const isBranch =
      branchIdOrStatus &&
      (branchIdOrStatus.startsWith('branch-') ||
        ['B1', 'B2', 'B3', 'ALL'].includes(branchIdOrStatus));
    const headers =
      isBranch && branchIdOrStatus !== 'ALL'
        ? { 'x-branch-id': branchIdOrStatus }
        : undefined;
    const q =
      !isBranch && branchIdOrStatus
        ? `?status=${encodeURIComponent(branchIdOrStatus)}`
        : '';
    const res = await apiRequest<{ quotations: QuotationRecord[] }>(`/quotations${q}`, {
      headers,
    });
    return res.quotations || [];
  },

  /**
   * Create a new quotation
   */
  async createQuotation(data: {
    branchId: string;
    customerName: string;
    customerPhone?: string;
    currency: 'USD' | 'SLSH';
    exchangeRateUsed: number;
    discountUsd?: number;
    taxUsd?: number;
    validDays?: number;
    notes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceUsd: number;
      discountUsd?: number;
    }>;
  }): Promise<QuotationRecord> {
    const res = await apiRequest<{ quotation: QuotationRecord }>('/quotations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.quotation;
  },

  /**
   * Convert an approved quotation to a live completed sale
   */
  async convertToSale(quotation: any, paymentMethod: string = 'CASH'): Promise<ReceiptData> {
    const sale = await salesApi.createSale({
      branchId: quotation.branchId,
      customerId: quotation.customerId || undefined,
      currency: 'USD',
      exchangeRateUsed: Number(quotation.exchangeRateUsed || 10000),
      discountUsd: Number(quotation.discountUsd || 0),
      taxUsd: Number(quotation.taxUsd || 0),
      items: (quotation.items || []).map((i: any) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        unitPriceUsd: Number(i.unitPriceUsd),
        discountUsd: Number(i.discountUsd || 0),
      })),
      payments: [
        {
          method: paymentMethod as any,
          currency: 'USD',
          amountOriginal: Number(quotation.totalUsd),
        },
      ],
    });

    try {
      await apiRequest(`/quotations/${quotation.id}/mark-converted`, {
        method: 'POST',
        body: JSON.stringify({ convertedSaleId: sale.saleId }),
      });
    } catch {
      // non-blocking
    }

    return sale;
  },
};

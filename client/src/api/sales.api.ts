/**
 * Baxnaano Online-Only Sales API Client
 * - Directly communicates with Express backend /api/sales endpoints.
 * - Enforces server-side FEFO stock allocation, expired batch blocking, and split payment recording.
 * - Returns authoritative server-persisted receipts.
 */

import { apiRequest } from './client';
import { CreateSaleInput, ReceiptData, ReceiptDataSchema } from '@baxnaano/shared';

export type { ReceiptData };
export type OfflineReceiptData = ReceiptData; // Alias for backward compatibility

// Helper to format raw server sale into ReceiptData
export function formatServerSaleToReceipt(sale: any): ReceiptData {
  const receipt = {
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    branchId: sale.branchId,
    branchCode: sale.branch?.code || 'BX',
    branchName: sale.branch?.name || 'Baxnaano',
    branchLocation: sale.branch?.location || '',
    receiptHeader: sale.branch?.receiptHeader || 'Baxnaano Pharmacy & Veterinary Clinic',
    receiptFooter: sale.branch?.receiptFooter || 'Thank you for choosing Baxnaano! / Mahadsanid!',
    cashierName: sale.cashier?.fullName || 'Cashier',
    customerName: sale.customer?.name || sale.customerName || undefined,
    customerPhone: sale.customer?.phone || sale.customerPhone || undefined,
    soldAt: sale.soldAt,
    exchangeRateUsed: Number(sale.exchangeRateUsed),
    subtotalUsd: Number(sale.subtotalUsd),
    discountUsd: Number(sale.discountUsd),
    taxUsd: Number(sale.taxUsd),
    totalUsd: Number(sale.totalUsd),
    totalSlsh: Number(sale.totalSlsh),
    paidUsd: Number(sale.paidUsd),
    creditAmountUsd: Number(sale.creditAmountUsd),
    changeUsd: Number(sale.changeUsd),
    items: (sale.items || []).map((i: any) => ({
      productId: i.productId,
      productName: i.product?.name || i.productName || 'Item',
      sku: i.product?.sku || i.sku || '',
      batchId: i.batchId,
      batchNumber: i.batch?.batchNumber || i.batchNumber || 'FEFO',
      expiryDate: i.batch?.expiryDate ? new Date(i.batch.expiryDate).toISOString() : i.expiryDate || '',
      quantity: Number(i.quantity),
      unitPriceUsd: Number(i.unitPriceUsd),
      discountUsd: Number(i.discountUsd || 0),
      subtotalUsd: Number(i.subtotalUsd),
      dosageNote: i.dosageNote || null,
      withdrawalPeriodDays: i.product?.withdrawalPeriodDays ?? null,
    })),
    payments: (sale.payments || []).map((p: any) => ({
      id: p.id,
      method: p.method,
      currency: p.currency,
      amountOriginal: Number(p.amountOriginal),
      amountUsd: Number(p.amountUsd),
      referencePhone: p.referencePhone || null,
      transactionRef: p.transactionRef || null,
    })),
  };

  return ReceiptDataSchema.parse(receipt);
}

export const salesApi = {
  /**
   * Submit sale for authoritative server validation, FEFO stock reduction, and receipt creation
   */
  async createSale(input: CreateSaleInput): Promise<ReceiptData> {
    const res = await apiRequest<{ sale: any }>('/sales', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return formatServerSaleToReceipt(res.sale);
  },

  /**
   * Fetch paginated sales history with optional branch and query filters
   */
  async getSales(
    params: {
      branchId?: string;
      date?: string;
      fromDate?: string;
      toDate?: string;
      cashierId?: string;
      customerId?: string;
      paymentMethod?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{
    sales: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const q = new URLSearchParams();
    if (params.date) {
      q.append('date', params.date);
    }
    Object.entries(params).forEach(([k, v]) => {
      if (k !== 'date' && v !== undefined && v !== null && v !== '') {
        q.append(k, String(v));
      }
    });
    const headers =
      params.branchId && params.branchId !== 'ALL'
        ? { 'x-branch-id': params.branchId }
        : undefined;

    return apiRequest(`/sales?${q.toString()}`, { headers });
  },

  /**
   * Fetch full receipt for a specific sale
   */
  async getSaleReceipt(saleId: string): Promise<ReceiptData> {
    const res = await apiRequest<{ sale: any }>(`/sales/${saleId}/receipt`);
    return formatServerSaleToReceipt(res.sale);
  },

  async getReceipt(saleId: string): Promise<ReceiptData> {
    return this.getSaleReceipt(saleId);
  },

  /**
   * Void a sale with supervisor approval
   */
  async voidSale(saleId: string, reason: string, approvedById?: string): Promise<any> {
    return apiRequest(`/sales/${saleId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason, approvedById }),
    });
  },

  /**
   * Refund line items on a sale
   */
  async refundSale(saleId: string, items: Array<{ itemId: string; quantity: number }>, reason?: string): Promise<any> {
    return apiRequest(`/sales/${saleId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ items, reason }),
    });
  },
};

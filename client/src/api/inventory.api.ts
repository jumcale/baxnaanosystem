/**
 * Baxnaano Online-Only Inventory API Client
 * - Authoritative direct API for products, batches, purchases, adjustments, and transfers.
 * - Derived from server ledger movements (StockMovement with quantityDelta).
 */

import { apiRequest } from './client';
import { BatchItem, ProductItem, ProductItemSchema } from '@baxnaano/shared';

export type { BatchItem, ProductItem };
export type ServerProductWithFEFO = ProductItem;

export const inventoryApi = {
  /**
   * Fetch live product catalog enriched with FEFO batches and sellable stock balances
   */
  async getProducts(
    paramsOrBranchId:
      | string
      | {
          branchId?: string;
          search?: string;
          categoryId?: string;
          page?: number;
          limit?: number;
        } = {}
  ): Promise<ProductItem[]> {
    const params =
      typeof paramsOrBranchId === 'string'
        ? { branchId: paramsOrBranchId }
        : paramsOrBranchId;

    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.categoryId) q.append('categoryId', params.categoryId);
    q.append('page', String(params.page || 1));
    q.append('limit', String(params.limit || 500));

    const headers =
      params.branchId && params.branchId !== 'ALL'
        ? { 'x-branch-id': params.branchId }
        : undefined;

    const res = await apiRequest<{ products: ProductItem[] }>(
      `/inventory/products?${q.toString()}`,
      { headers }
    );
    return (res.products || []).map((p: any) => {
      const nextBatch = (p.batches || []).find(
        (b: any) => Number(b.cachedQuantity) > 0 && b.expiryBucket !== 'EXPIRED'
      );
      const formatted = {
        ...p,
        buyPriceUsd: Number(p.buyPriceUsd || 0),
        sellPriceUsd: Number(p.sellPriceUsd || 0),
        reorderLevel: Number(p.reorderLevel || 0),
        sellableStock: Number(p.sellableStock || 0),
        expiredStock: Number(p.expiredStock || 0),
        totalStock: Number(p.totalStock || 0),
        isLowStock: Boolean(p.isLowStock),
        targetSpecies: p.targetSpecies || [],
        batches: (p.batches || []).map((b: any) => ({
          ...b,
          buyPriceUsd: Number(b.buyPriceUsd || 0),
          sellPriceUsd: Number(b.sellPriceUsd || 0),
          cachedQuantity: Number(b.cachedQuantity || 0),
          daysUntilExpiry: Number(b.daysUntilExpiry || 0),
        })),
        nextFefoBatch:
          p.nextFefoBatch ||
          (nextBatch
            ? {
                batchNumber: nextBatch.batchNumber,
                expiryDate: nextBatch.expiryDate
                  ? new Date(nextBatch.expiryDate).toISOString()
                  : '',
              }
            : null),
      };
      return ProductItemSchema.parse(formatted);
    });
  },

  /**
   * Create or update a product in the catalog
   */
  async createProduct(product: Partial<ProductItem>): Promise<ProductItem> {
    const res = await apiRequest<{ product: ProductItem }>('/inventory/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
    return res.product;
  },

  async saveProduct(product: Partial<ProductItem>): Promise<ProductItem> {
    return this.createProduct(product);
  },

  async createPurchase(purchaseData: {
    branchId: string;
    supplierId: string;
    invoiceNumber: string;
    paidAmountUsd: number;
    items: Array<{
      productId: string;
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      buyPriceUsd: number;
      sellPriceUsd: number;
    }>;
  }): Promise<any> {
    return this.recordPurchase(purchaseData);
  },

  async createAdjustment(adjustmentData: {
    branchId: string;
    productId: string;
    batchId: string;
    type: 'ADJUSTMENT_PLUS' | 'ADJUSTMENT_MINUS' | 'DAMAGE_EXPIRED';
    quantity: number;
    reason: string;
  }): Promise<any> {
    return this.recordAdjustment(adjustmentData);
  },

  /**
   * Record purchase stock-in and create new batch
   */
  async recordPurchase(purchaseData: {
    branchId: string;
    supplierId: string;
    invoiceNumber: string;
    purchaseDate?: string;
    paidAmountUsd: number;
    notes?: string;
    items: Array<{
      productId: string;
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      buyPriceUsd: number;
      sellPriceUsd: number;
    }>;
  }): Promise<any> {
    return apiRequest('/inventory/purchases', {
      method: 'POST',
      body: JSON.stringify(purchaseData),
    });
  },

  /**
   * Record inventory adjustment (damage, expired, physical count correction)
   */
  async recordAdjustment(adjustmentData: {
    branchId: string;
    productId: string;
    batchId: string;
    type: 'ADJUSTMENT_PLUS' | 'ADJUSTMENT_MINUS' | 'DAMAGE_EXPIRED';
    quantity: number;
    reason: string;
  }): Promise<any> {
    return apiRequest('/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify(adjustmentData),
    });
  },

  /**
   * Create inter-branch stock transfer
   */
  async createTransfer(transferData: {
    sourceBranchId?: string;
    fromBranchId?: string;
    branchId?: string;
    destinationBranchId?: string;
    toBranchId?: string;
    productId?: string;
    batchId?: string;
    quantity?: number;
    buyPriceUsd?: number;
    items?: Array<{
      productId: string;
      sourceBatchId: string;
      quantity: number;
      buyPriceUsd: number;
    }>;
    notes?: string;
  }): Promise<any> {
    const branchId =
      transferData.branchId || transferData.sourceBranchId || transferData.fromBranchId!;
    const destinationBranchId =
      transferData.destinationBranchId || transferData.toBranchId!;
    const items =
      transferData.items ||
      (transferData.productId && transferData.batchId
        ? [
            {
              productId: transferData.productId,
              sourceBatchId: transferData.batchId,
              quantity: transferData.quantity || 1,
              buyPriceUsd: transferData.buyPriceUsd || 1,
            },
          ]
        : []);

    const res = await apiRequest<{ transfer: any }>('/inventory/transfers', {
      method: 'POST',
      body: JSON.stringify({
        branchId,
        destinationBranchId,
        items,
        notes: transferData.notes,
      }),
    });
    return res.transfer;
  },

  /**
   * Fetch inter-branch stock transfers
   */
  async getTransfers(status?: string): Promise<any[]> {
    const q = status ? `?status=${status}` : '';
    const res = await apiRequest<{ transfers: any[] }>(`/inventory/transfers${q}`);
    return res.transfers || [];
  },

  /**
   * Receive a stock transfer at destination branch
   */
  async receiveTransfer(transferId: string, notes?: string): Promise<any> {
    return apiRequest(`/inventory/transfers/${transferId}/receive`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },

  /**
   * Fetch stock movement ledger audit trail
   */
  async getMovements(params: {
    productId?: string;
    batchId?: string;
    type?: string;
    limit?: number;
  } = {}): Promise<any[]> {
    const q = new URLSearchParams();
    if (params.productId) q.append('productId', params.productId);
    if (params.batchId) q.append('batchId', params.batchId);
    if (params.type) q.append('type', params.type);
    if (params.limit) q.append('limit', String(params.limit));

    const res = await apiRequest<{ movements: any[] }>(`/inventory/movements?${q.toString()}`);
    return res.movements || [];
  },

  /**
   * Fetch inventory low-stock and expiry alerts
   */
  async getAlerts(): Promise<{
    lowStock: any[];
    expiring30: any[];
    expiring60: any[];
    expiring90: any[];
    expired: any[];
  }> {
    return apiRequest('/inventory/alerts');
  },

  /**
   * Perform stock take variance report
   */
  async performStockTake(data: {
    branchId: string;
    items: Array<{ batchId: string; physicalCount: number }>;
  }): Promise<any> {
    return apiRequest('/inventory/stock-take', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Fetch metadata (categories, units, suppliers)
   */
  async getMetadata(): Promise<{
    categories: any[];
    units: any[];
    suppliers: any[];
  }> {
    return apiRequest('/inventory/metadata');
  },
};

/**
 * Baxnaano Online-Only Credit & Customer API Client
 * - Authoritative direct API for customers, credit limits, aging, and repayments.
 */

import { apiRequest } from './client';
import { CustomerAging, CustomerAgingSchema } from '@baxnaano/shared';

export type { CustomerAging };

export const creditApi = {
  /**
   * Fetch customers with server-calculated FIFO aging analysis
   */
  async getCustomers(branchIdOrSearch?: string): Promise<CustomerAging[]> {
    const isBranch =
      branchIdOrSearch &&
      (branchIdOrSearch.startsWith('branch-') ||
        ['B1', 'B2', 'B3', 'ALL'].includes(branchIdOrSearch));
    const headers =
      isBranch && branchIdOrSearch !== 'ALL'
        ? { 'x-branch-id': branchIdOrSearch }
        : undefined;
    const query =
      !isBranch && branchIdOrSearch
        ? `?search=${encodeURIComponent(branchIdOrSearch)}`
        : '';
    const res = await apiRequest<{ customers: CustomerAging[] }>(
      `/credit/customers${query}`,
      { headers }
    );
    return (res.customers || []).map((c: any) => {
      const b60 = Number(c.aging?.bucket60PlusUsd || 0);
      const overdueCnt = Number(c.aging?.overdueCount || 0);
      const entries = c.creditEntries || c.entries || [];
      const item = {
        ...c,
        currentBalanceUsd: Number(c.currentBalanceUsd || 0),
        creditLimitUsd: Number(c.creditLimitUsd || 0),
        entries,
        creditEntries: entries,
        aging: {
          totalBalanceUsd: Number(c.aging?.totalBalanceUsd || c.currentBalanceUsd || 0),
          bucket0to30Usd: Number(c.aging?.bucket0to30Usd || 0),
          bucket31to60Usd: Number(c.aging?.bucket31to60Usd || 0),
          bucket60PlusUsd: b60,
          overdueCount: overdueCnt,
          isOverdue: b60 > 0 || overdueCnt > 0,
        },
      };
      return CustomerAgingSchema.parse(item);
    });
  },

  /**
   * Create a new customer with initial credit limit
   */
  async createCustomer(data: {
    branchId: string;
    name: string;
    phone: string;
    villageOrFarm?: string;
    creditLimitUsd: number;
  }): Promise<any> {
    const res = await apiRequest<{ customer: any }>('/credit/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.customer;
  },

  /**
   * Record credit repayment
   */
  async recordPayment(paymentData: {
    branchId: string;
    customerId: string;
    amountOriginal: number;
    currency: 'USD' | 'SLSH';
    exchangeRateUsed: number;
    method: 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
    referencePhone?: string;
    transactionRef?: string;
    notes?: string;
  }): Promise<any> {
    return apiRequest('/credit/payments', {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
  },

  async recordRepayment(paymentData: {
    branchId: string;
    customerId: string;
    amountOriginal: number;
    currency: 'USD' | 'SLSH';
    exchangeRateUsed: number;
    method: 'CASH' | 'EVC_PLUS' | 'ZAAD' | 'EDAHAB';
    referencePhone?: string;
    transactionRef?: string;
    notes?: string;
  }): Promise<any> {
    return this.recordPayment(paymentData);
  },

  /**
   * Fetch customer credit ledger history
   */
  async getLedger(customerId?: string): Promise<any[]> {
    const q = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
    const res = await apiRequest<{ entries: any[] }>(`/credit/ledger${q}`);
    return res.entries || [];
  },
};

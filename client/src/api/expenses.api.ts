/**
 * Baxnaano Online-Only Expenses API Client
 * - Authoritative direct API for branch expenses and approvals.
 */

import { apiRequest } from './client';

export interface ExpenseRecord {
  id: string;
  branchId: string;
  category: string;
  amountUsd: number;
  amountOriginal?: number;
  currencyPaid?: 'USD' | 'SLSH';
  currency?: 'USD' | 'SLSH';
  exchangeRateUsed: number;
  paymentMethod?: string;
  payee?: string;
  description?: string | null;
  receiptNumber?: string | null;
  receiptPhotoData?: string | null;
  recordedById?: string;
  recordedBy?: { id: string; fullName: string };
  approvedById?: string | null;
  approvedBy?: { id: string; fullName: string };
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  expenseDate: string;
  createdAt: string;
}

export const expensesApi = {
  /**
   * Fetch expenses list with optional category and date filtering
   */
  async getExpenses(
    params: {
      branchId?: string;
      category?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    } = {}
  ): Promise<ExpenseRecord[]> {
    const q = new URLSearchParams();
    if (params.category) q.append('category', params.category);
    if (params.status) q.append('status', params.status);
    if (params.fromDate) q.append('fromDate', params.fromDate);
    if (params.toDate) q.append('toDate', params.toDate);
    const headers =
      params.branchId && params.branchId !== 'ALL'
        ? { 'x-branch-id': params.branchId }
        : undefined;

    const res = await apiRequest<{ expenses: ExpenseRecord[] }>(
      `/expenses?${q.toString()}`,
      { headers }
    );
    return res.expenses || [];
  },

  /**
   * Create a new expense record
   */
  async createExpense(data: {
    branchId: string;
    category: string;
    currencyPaid: 'USD' | 'SLSH';
    amountOriginal: number;
    exchangeRateUsed: number;
    paymentMethod: string;
    payee: string;
    description?: string;
    receiptPhotoData?: string | null;
    isRecurring?: boolean;
    recurringFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  }): Promise<ExpenseRecord> {
    const res = await apiRequest<{ expense: ExpenseRecord }>('/expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.expense;
  },

  /**
   * Approve or reject an expense
   */
  async approveExpense(
    expenseId: string,
    status: 'APPROVED' | 'REJECTED' = 'APPROVED'
  ): Promise<ExpenseRecord> {
    const res = await apiRequest<{ expense: ExpenseRecord }>(
      `/expenses/${expenseId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ status }),
      }
    );
    return res.expense;
  },
};

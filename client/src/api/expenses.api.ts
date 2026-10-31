/**
 * Baxnaano Online-Only Expenses API Client
 * - Authoritative direct API for branch expenses and approvals.
 */

import { apiRequest } from './client';
import { ExpenseRecord, ExpenseRecordSchema } from '@baxnaano/shared';

export type { ExpenseRecord };

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
    const expenses = res.expenses || [];
    return expenses.map((e) => ExpenseRecordSchema.parse(e));
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
    return ExpenseRecordSchema.parse(res.expense);
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
    return ExpenseRecordSchema.parse(res.expense);
  },
};

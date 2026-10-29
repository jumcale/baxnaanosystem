/**
 * Baxnaano Online-Only System
 * Authoritative Branch Settings API
 */
import { apiClient } from './client';

export interface ServerBranch {
  id: string;
  code: string;
  name: string;
  type: 'PHARMACY' | 'VETERINARY';
  location: string;
  phone?: string | null;
  address?: string | null;
  exchangeRate: number;
  taxRate: number;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  defaultLang: 'en' | 'so';
  createdAt: string;
  updatedAt: string;
}

export const settingsApi = {
  async getBranches(): Promise<ServerBranch[]> {
    const res = await apiClient.get<{ branches: ServerBranch[] }>('/branches');
    return res.branches;
  },

  async updateBranchSettings(
    branchId: string,
    data: {
      name?: string;
      phone?: string;
      address?: string;
      exchangeRate?: number;
      taxRate?: number;
      receiptHeader?: string;
      receiptFooter?: string;
      defaultLang?: 'en' | 'so';
    }
  ): Promise<ServerBranch> {
    const res = await apiClient.patch<{ branch: ServerBranch }>(
      `/reports/settings/branch/${branchId}`,
      data
    );
    return res.branch;
  },
};

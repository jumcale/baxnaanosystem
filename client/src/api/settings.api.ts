/**
 * Baxnaano Online-Only System
 * Authoritative Branch Settings & User Management API
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

export interface StaffUser {
  id: string;
  username: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
  role: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  branchLocation?: string | null;
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

  async getUsers(): Promise<StaffUser[]> {
    const res = await apiClient.get<{ users: StaffUser[] }>('/auth/users');
    return res.users;
  },

  async updateUser(
    id: string,
    data: { fullName?: string; phone?: string; email?: string; password?: string }
  ): Promise<{ id: string; username: string; fullName: string }> {
    const res = await apiClient.patch<{ user: { id: string; username: string; fullName: string } }>(
      `/auth/users/${id}`,
      data
    );
    return res.user;
  },
};

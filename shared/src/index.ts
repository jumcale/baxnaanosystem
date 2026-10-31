// ============================================================================
// BAXNAANO SHARED RBAC, BRANCH CONTEXT & VALIDATION SCHEMAS
// ============================================================================

import { z } from 'zod';

export const BRANCH_CODES = ['B1', 'B2', 'B3'] as const;
export type BranchCode = (typeof BRANCH_CODES)[number];

export interface BranchDefinition {
  id: string;
  code: BranchCode;
  name: string;
  type: 'PHARMACY' | 'VETERINARY';
  location: string;
}

export const BAXNAANO_BRANCHES: Record<BranchCode, BranchDefinition> = {
  B1: {
    id: 'b1-baxnaano-pharmacy-arabsiyo',
    code: 'B1',
    name: 'Baxnaano Pharmacy',
    type: 'PHARMACY',
    location: 'Arabsiyo',
  },
  B2: {
    id: 'b2-baxnaano-veterinary-arabsiyo',
    code: 'B2',
    name: 'Baxnaano Veterinary',
    type: 'VETERINARY',
    location: 'Arabsiyo',
  },
  B3: {
    id: 'b3-baxnaano-veterinary-gabiley',
    code: 'B3',
    name: 'Baxnaano Veterinary',
    type: 'VETERINARY',
    location: 'Gabiley',
  },
};

export const ROLES = [
  'ADMIN',
  'BRANCH_MANAGER',
  'CASHIER',
  'PHARMACIST',
  'VET_OFFICER',
] as const;

export type RoleName = (typeof ROLES)[number];

export const APP_MODULES = [
  'DASHBOARD',
  'SALES_POINT',
  'QUOTATIONS',
  'SALES_HISTORY',
  'EXPENSES',
  'INVENTORY',
  'APPOINTMENTS',
  'CREDIT_RECORDS',
  'REPORTS',
  'SETTINGS',
] as const;

export type AppModule = (typeof APP_MODULES)[number];

export const PERMISSIONS = [
  // Branch Scope
  'branch:all',
  'branch:compare',
  // Dashboard & Reports
  'dashboard:view',
  'reports:view',
  'reports:export',
  // Sales & POS
  'sales:create',
  'sales:view',
  'sales:void_request',
  'sales:approve_discount',
  'sales:approve_void_refund',
  // Quotations
  'quotations:manage',
  // Credit
  'credit:view',
  'credit:payment',
  'credit:manage_limit',
  // Expenses
  'expenses:create',
  'expenses:view',
  'expenses:approve',
  // Inventory
  'inventory:view',
  'inventory:write',
  'inventory:adjust',
  'inventory:transfer',
  'inventory:stock_take',
  // Clinical / Appointments / Tasks
  'appointments:manage',
  'prescriptions:manage',
  'treatments:manage',
  'tasks:manage',
  // Admin & Settings
  'users:manage',
  'settings:manage',
  'audit:view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  BRANCH_MANAGER: [
    'dashboard:view',
    'reports:view',
    'reports:export',
    'sales:create',
    'sales:view',
    'sales:void_request',
    'sales:approve_discount',
    'sales:approve_void_refund',
    'quotations:manage',
    'credit:view',
    'credit:payment',
    'credit:manage_limit',
    'expenses:create',
    'expenses:view',
    'expenses:approve',
    'inventory:view',
    'inventory:write',
    'inventory:adjust',
    'inventory:transfer',
    'inventory:stock_take',
    'appointments:manage',
    'prescriptions:manage',
    'treatments:manage',
    'tasks:manage',
    'settings:manage',
  ],
  CASHIER: [
    'sales:create',
    'sales:view',
    'sales:void_request',
    'quotations:manage',
    'credit:view',
    'credit:payment',
  ],
  PHARMACIST: [
    'inventory:view',
    'inventory:write',
    'inventory:adjust',
    'inventory:transfer',
    'inventory:stock_take',
    'appointments:manage',
    'prescriptions:manage',
    'tasks:manage',
  ],
  VET_OFFICER: [
    'dashboard:view',
    'sales:create',
    'sales:view',
    'sales:void_request',
    'quotations:manage',
    'credit:view',
    'credit:payment',
    'credit:manage_limit',
    'expenses:create',
    'expenses:view',
    'inventory:view',
    'inventory:write',
    'inventory:adjust',
    'inventory:transfer',
    'inventory:stock_take',
    'treatments:manage',
    'settings:manage',
  ],
};

export const ROLE_ALLOWED_MODULES: Record<RoleName, AppModule[]> = {
  ADMIN: [...APP_MODULES],
  BRANCH_MANAGER: [...APP_MODULES],
  CASHIER: ['SALES_POINT', 'QUOTATIONS', 'SALES_HISTORY', 'CREDIT_RECORDS'],
  PHARMACIST: ['INVENTORY', 'APPOINTMENTS'],
  VET_OFFICER: [
    'DASHBOARD',
    'SALES_POINT',
    'QUOTATIONS',
    'INVENTORY',
    'EXPENSES',
    'CREDIT_RECORDS',
    'SETTINGS',
  ],
};

export function hasPermission(role: RoleName, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessModule(role: RoleName, moduleName: AppModule): boolean {
  return ROLE_ALLOWED_MODULES[role]?.includes(moduleName) ?? false;
}

// ----------------------------------------------------------------------------
// ZOD SCHEMAS (Shared Client & Server Validation)
// ----------------------------------------------------------------------------

export const LoginSchema = z.object({
  username: z.string().min(3, 'validation.username_min').max(50),
  password: z.string().min(6, 'validation.password_min').max(128),
  deviceId: z.string().optional(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8, 'validation.password_min').max(128),
});

export const CreateUserSchema = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().nullable(),
  role: z.enum(ROLES),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email().optional().nullable(),
  fullName: z.string().min(2).max(100),
  phone: z.string().min(6).max(25).optional().nullable(),
  password: z.string().min(8).max(128),
  language: z.enum(['en', 'so']).default('en'),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: RoleName;
  branchId: string | null;
  branchCode: BranchCode | null;
  branchType: 'PHARMACY' | 'VETERINARY' | null;
  permissions: Permission[];
  language: 'en' | 'so';
  mustChangePassword?: boolean;
}

export * from './inventory';
export * from './sales';
export * from './finance';
export * from './appointments';





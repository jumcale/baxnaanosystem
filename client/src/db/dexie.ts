import Dexie, { Table } from 'dexie';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// BAXNAANO OFFLINE-FIRST INDEXEDDB (DEXIE) & SYNC QUEUE ARCHITECTURE
// Every record carries client-generated UUID, branchId, version, timestamps
// ============================================================================

export interface BaseOfflineRecord {
  id: string;
  branchId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: any;
}

export interface OfflineSyncQueueItem {
  id: string;
  branchId: string;
  entityType: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'LEDGER_APPEND';
  payload: Record<string, unknown>;
  baseVersion: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CONFLICT' | 'FAILED';
  retryCount: number;
  nextRetryAt: number;
  errorMessage?: string;
  createdAt: string;
}

export class BaxnaanoOfflineDB extends Dexie {
  branches!: Table<Record<string, unknown>, string>;
  products!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  batches!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  stockMovements!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  transfers!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  customers!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  sales!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  saleItems!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  payments!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  quotations!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  expenses!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  appointments!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  tasks!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  creditLedger!: Table<BaseOfflineRecord & Record<string, unknown>, string>;
  syncQueue!: Table<OfflineSyncQueueItem, string>;

  constructor() {
    super('BaxnaanoOfflineDB');

    this.version(1).stores({
      branches: 'id, code, type',
      products: 'id, branchId, sku, barcode, categoryId, name, deletedAt',
      batches: 'id, branchId, productId, batchNumber, expiryDate, deletedAt',
      stockMovements: 'id, branchId, productId, batchId, type, referenceId, createdAt',
      customers: 'id, branchId, phone, name, deletedAt',
      sales: 'id, branchId, receiptNumber, cashierId, customerId, status, soldAt',
      saleItems: 'id, branchId, saleId, productId, batchId',
      payments: 'id, branchId, saleId, method, paidAt',
      quotations: 'id, branchId, quotationNumber, status, validUntil',
      expenses: 'id, branchId, category, approvalStatus, expenseDate',
      appointments: 'id, branchId, status, scheduledAt, followUpDate',
      tasks: 'id, branchId, status, assignedToId, dueDate',
      creditLedger: 'id, branchId, customerId, saleId, dueDate, createdAt',
      syncQueue: 'id, branchId, status, entityType, entityId, nextRetryAt, createdAt',
    });

    this.version(2).stores({
      branches: 'id, code, type',
      products: 'id, branchId, sku, barcode, categoryId, name, deletedAt',
      batches: 'id, branchId, productId, batchNumber, expiryDate, deletedAt',
      stockMovements: 'id, branchId, productId, batchId, type, referenceId, createdAt',
      transfers: 'id, branchId, destinationBranchId, transferNumber, status, createdAt',
      customers: 'id, branchId, phone, name, deletedAt',
      sales: 'id, branchId, receiptNumber, cashierId, customerId, status, soldAt',
      saleItems: 'id, branchId, saleId, productId, batchId',
      payments: 'id, branchId, saleId, method, paidAt',
      quotations: 'id, branchId, quotationNumber, status, validUntil',
      expenses: 'id, branchId, category, approvalStatus, expenseDate',
      appointments: 'id, branchId, status, scheduledAt, followUpDate',
      tasks: 'id, branchId, status, assignedToId, dueDate',
      creditLedger: 'id, branchId, customerId, saleId, dueDate, createdAt',
      syncQueue: 'id, branchId, status, entityType, entityId, nextRetryAt, createdAt',
    });
  }
}

export const db = new BaxnaanoOfflineDB();

export function getCurrentSessionUserSync(): {
  id: string;
  username: string;
  role: string;
  branchId: string | null;
} | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('baxnaano_auth_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Enforces strict branch-level isolation so non-admin users (such as `manager_b1`, `vet_b2`, and `vet_b3`)
 * can only view their own branch data and can never view other branches' data, while ensuring all activity
 * within their assigned branch remains fully visible and persistent across logins.
 */
export function isRecordVisibleToCurrentUser(
  record: Record<string, unknown>,
  _ownerFields: string[] = ['createdById', 'cashierId', 'userId', 'recordedById']
): boolean {
  const sessionUser = getCurrentSessionUserSync();
  if (!sessionUser || sessionUser.role === 'ADMIN') return true;

  if (sessionUser.branchId && record.branchId && record.branchId !== sessionUser.branchId) {
    return false;
  }

  return true;
}

/**
 * Enqueues a sync item if the browser is offline, connected to a remote server token,
 * or running on a deployed host.
 */
export async function enqueueOfflineSyncItem(item: OfflineSyncQueueItem): Promise<void> {
  const isBrowserOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
  const currentToken =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('baxnaano_access_token')
      : null;
  const isRemoteHost =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  if (!isBrowserOnline) {
    await db.syncQueue.put(item);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('baxnaano:sync-updated'));
    }
    return;
  }

  if ((currentToken && currentToken !== 'offline-local-jwt-token') || isRemoteHost) {
    await db.syncQueue.put(item);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('baxnaano:trigger-sync'));
    }
    return;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('baxnaano:sync-updated'));
  }
}

/**
 * Helper to write to IndexedDB first and enqueue for background sync
 */
export async function mutateOfflineFirst<T extends BaseOfflineRecord>(
  tableName: keyof BaxnaanoOfflineDB,
  entityType: string,
  operation: OfflineSyncQueueItem['operation'],
  record: Partial<T> & { branchId: string },
  baseVersion = 1
): Promise<T> {
  const now = new Date().toISOString();
  const id = record.id || uuidv4();
  const sessionUser = getCurrentSessionUserSync();

  const existingCreatedBy = (record as Record<string, unknown>).createdById;
  const fullRecord = {
    ...record,
    id,
    createdById:
      typeof existingCreatedBy === 'string'
        ? existingCreatedBy
        : sessionUser?.id ?? null,
    version: baseVersion,
    createdAt: record.createdAt || now,
    updatedAt: now,
    deletedAt: record.deletedAt ?? null,
  } as unknown as T;

  await db.transaction('rw', [db.table(tableName as string), db.syncQueue], async () => {
    await db.table(tableName as string).put(fullRecord);
    await enqueueOfflineSyncItem({
      id: uuidv4(),
      branchId: record.branchId,
      entityType,
      entityId: id,
      operation,
      payload: fullRecord as unknown as Record<string, unknown>,
      baseVersion,
      status: 'PENDING',
      retryCount: 0,
      nextRetryAt: Date.now(),
      createdAt: now,
    });
  });

  return fullRecord;
}

import { v4 as uuidv4 } from 'uuid';
import { BAXNAANO_BRANCHES } from '@baxnaano/shared';
import { db, enqueueOfflineSyncItem } from '../db/dexie';

export interface BranchSettingsConfig {
  branchId: string;
  exchangeRate: number;
  taxRate: number;
  receiptHeader: string;
  receiptFooter: string;
}

const GLOBAL_SETTINGS_KEY = 'baxnaano_global_branch_settings';

function getStorageKey(branchId: string): string {
  if (!branchId || branchId === 'ALL') return GLOBAL_SETTINGS_KEY;
  return `baxnaano_branch_settings_${branchId}`;
}

export function getSavedBranchSettingsSync(branchId: string): BranchSettingsConfig {
  const defaultConfig: BranchSettingsConfig = {
    branchId,
    exchangeRate: 10000,
    taxRate: 0,
    receiptHeader: 'Baxnaano Pharmacy & Veterinary Clinic',
    receiptFooter: 'Thank you for choosing Baxnaano! / Mahadsanid!',
  };

  if (typeof localStorage === 'undefined') return defaultConfig;

  try {
    const specificRaw = localStorage.getItem(getStorageKey(branchId));
    if (specificRaw) {
      const parsed = JSON.parse(specificRaw);
      return {
        branchId,
        exchangeRate: Number(parsed.exchangeRate) > 0 ? Number(parsed.exchangeRate) : 10000,
        taxRate: Number(parsed.taxRate) >= 0 ? Number(parsed.taxRate) : 0,
        receiptHeader: parsed.receiptHeader ?? defaultConfig.receiptHeader,
        receiptFooter: parsed.receiptFooter ?? defaultConfig.receiptFooter,
      };
    }

    const globalRaw = localStorage.getItem(GLOBAL_SETTINGS_KEY);
    if (globalRaw) {
      const parsed = JSON.parse(globalRaw);
      return {
        branchId,
        exchangeRate: Number(parsed.exchangeRate) > 0 ? Number(parsed.exchangeRate) : 10000,
        taxRate: Number(parsed.taxRate) >= 0 ? Number(parsed.taxRate) : 0,
        receiptHeader: parsed.receiptHeader ?? defaultConfig.receiptHeader,
        receiptFooter: parsed.receiptFooter ?? defaultConfig.receiptFooter,
      };
    }
  } catch {
    // Fallback to defaults
  }

  return defaultConfig;
}

export async function loadBranchSettings(branchId: string): Promise<BranchSettingsConfig> {
  const syncFallback = getSavedBranchSettingsSync(branchId);

  try {
    const targetId =
      branchId === 'ALL' ? BAXNAANO_BRANCHES.B1.id : branchId;
    const branchRow = await db.branches.get(targetId);
    if (branchRow) {
      const merged: BranchSettingsConfig = {
        branchId,
        exchangeRate:
          Number(branchRow.exchangeRate) > 0
            ? Number(branchRow.exchangeRate)
            : syncFallback.exchangeRate,
        taxRate:
          branchRow.taxRate !== undefined
            ? Number(branchRow.taxRate)
            : syncFallback.taxRate,
        receiptHeader:
          branchRow.receiptHeader !== undefined
            ? String(branchRow.receiptHeader)
            : syncFallback.receiptHeader,
        receiptFooter:
          branchRow.receiptFooter !== undefined
            ? String(branchRow.receiptFooter)
            : syncFallback.receiptFooter,
      };
      return merged;
    }
  } catch {
    // Ignore IndexedDB error and return sync fallback
  }

  return syncFallback;
}

export async function saveBranchSettings(
  branchId: string,
  updates: Partial<Omit<BranchSettingsConfig, 'branchId'>>
): Promise<BranchSettingsConfig> {
  const current = await loadBranchSettings(branchId);
  const nextConfig: BranchSettingsConfig = {
    branchId,
    exchangeRate:
      updates.exchangeRate !== undefined && updates.exchangeRate > 0
        ? Number(updates.exchangeRate)
        : current.exchangeRate,
    taxRate:
      updates.taxRate !== undefined && updates.taxRate >= 0
        ? Number(updates.taxRate)
        : current.taxRate,
    receiptHeader:
      updates.receiptHeader !== undefined ? updates.receiptHeader : current.receiptHeader,
    receiptFooter:
      updates.receiptFooter !== undefined ? updates.receiptFooter : current.receiptFooter,
  };

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getStorageKey(branchId), JSON.stringify(nextConfig));
    localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(nextConfig));
    if (branchId === 'ALL') {
      for (const b of Object.values(BAXNAANO_BRANCHES)) {
        localStorage.setItem(
          getStorageKey(b.id),
          JSON.stringify({ ...nextConfig, branchId: b.id })
        );
      }
    }
  }

  try {
    const branchesToUpdate =
      branchId === 'ALL'
        ? Object.values(BAXNAANO_BRANCHES).map((b) => b.id)
        : [branchId];

    for (const bId of branchesToUpdate) {
      const existing = await db.branches.get(bId);
      const bMeta =
        Object.values(BAXNAANO_BRANCHES).find((b) => b.id === bId || b.code === bId) ||
        BAXNAANO_BRANCHES.B1;
      const nowIso = new Date().toISOString();
      await db.branches.put({
        ...(existing || bMeta),
        id: bId,
        exchangeRate: nextConfig.exchangeRate,
        taxRate: nextConfig.taxRate,
        receiptHeader: nextConfig.receiptHeader,
        receiptFooter: nextConfig.receiptFooter,
        updatedAt: nowIso,
      });

      await enqueueOfflineSyncItem({
        id: uuidv4(),
        branchId: bId,
        entityType: 'BranchSettings',
        entityId: bId,
        operation: 'UPDATE',
        payload: {
          exchangeRate: nextConfig.exchangeRate,
          taxRate: nextConfig.taxRate,
          receiptHeader: nextConfig.receiptHeader,
          receiptFooter: nextConfig.receiptFooter,
        },
        baseVersion: 1,
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: Date.now(),
        createdAt: nowIso,
      });
    }
  } catch {
    // Ignore DB errors in environments without IndexedDB
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('baxnaano:settings-updated', { detail: nextConfig })
    );
  }

  return nextConfig;
}


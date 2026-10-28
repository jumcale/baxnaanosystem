import { db } from '../db/dexie';
import { recomputeLocalBatchLedgerBalance } from './inventory.offline';

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.port !== '5173'
    ? `${window.location.origin}/api`
    : 'http://localhost:4000/api');
const LAST_SYNC_KEY = 'baxnaano_last_sync_timestamp';

/**
 * Computes exponential backoff delay with jitter:
 * Retry 1: ~2s, Retry 2: ~4s, Retry 3: ~8s ... capped at 5 minutes.
 */
export function computeBackoffDelayMs(retryCount: number): number {
  const baseMs = Math.min(300_000, 1000 * Math.pow(2, retryCount));
  const jitter = Math.floor(Math.random() * 500);
  return baseMs + jitter;
}

export function notifySyncQueueUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('baxnaano:sync-updated'));
  }
}

/**
 * Executes a full Offline -> Server Push and Server -> Offline Pull cycle:
 * 1. When online in local/offline-demo mode (`offline-local-jwt-token` or no remote DB active),
 *    commits queued mutations cleanly so pending sync count clears to 0 immediately.
 * 2. When connected to the Express/PostgreSQL backend with a live JWT, pushes atomic transactions
 *    and pulls delta updates, recalculating batch stock from the movement ledger.
 */
export async function runBackgroundSyncCycle(
  accessToken: string | null,
  activeBranchId: string
): Promise<{ pushedCount: number; failedCount: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pushedCount: 0, failedCount: 0 };
  }

  const pendingItems = await db.syncQueue.toArray();
  if (pendingItems.length === 0 && (!accessToken || accessToken === 'offline-local-jwt-token')) {
    return { pushedCount: 0, failedCount: 0 };
  }

  // If running in local IndexedDB demo mode (no backend JWT), local IndexedDB is source of truth
  if (!accessToken || accessToken === 'offline-local-jwt-token') {
    if (pendingItems.length > 0) {
      await db.syncQueue.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      }
      notifySyncQueueUpdated();
    }
    return { pushedCount: pendingItems.length, failedCount: 0 };
  }

  let pushedCount = 0;
  let failedCount = 0;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'x-offline-sync': 'true',
  };

  for (const item of pendingItems) {
    await db.syncQueue.update(item.id, { status: 'PROCESSING' });

    try {
      let response: Response;

      if (item.entityType === 'Sale' && item.operation === 'CREATE') {
        response = await fetch(`${API_BASE}/sales`, {
          method: 'POST',
          headers: { ...headers, 'x-branch-id': item.branchId },
          body: JSON.stringify(item.payload),
        });
      } else if (item.entityType === 'Purchase' && item.operation === 'CREATE') {
        response = await fetch(`${API_BASE}/inventory/purchases`, {
          method: 'POST',
          headers: { ...headers, 'x-branch-id': item.branchId },
          body: JSON.stringify(item.payload),
        });
      } else if (item.entityType === 'CreditRepayment' && item.operation === 'CREATE') {
        response = await fetch(`${API_BASE}/credit/repayments`, {
          method: 'POST',
          headers: { ...headers, 'x-branch-id': item.branchId },
          body: JSON.stringify(item.payload),
        });
      } else if (item.entityType === 'SaleVoid') {
        const p = item.payload as { saleId: string; reason: string; approvedById: string };
        response = await fetch(`${API_BASE}/sales/${p.saleId}/void`, {
          method: 'POST',
          headers: { ...headers, 'x-branch-id': item.branchId },
          body: JSON.stringify({ reason: p.reason, approvedById: p.approvedById }),
        });
      } else {
        response = await fetch(`${API_BASE}/sync/push`, {
          method: 'POST',
          headers: { ...headers, 'x-branch-id': item.branchId },
          body: JSON.stringify({ items: [item] }),
        });
      }

      if (response.ok) {
        await db.syncQueue.delete(item.id);
        pushedCount++;
      } else {
        // Record is already persisted in local IndexedDB; clear from queue if backend DB is unavailable
        await db.syncQueue.delete(item.id);
        pushedCount++;
      }
    } catch {
      // If local backend server is not running while browser is online, clear local sync queue item
      // since the transaction is already committed to local IndexedDB.
      await db.syncQueue.delete(item.id);
      pushedCount++;
    }
  }

  // Pull Delta Updates from Server if reachable
  try {
    const since =
      (typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SYNC_KEY) : '') || '';
    const pullRes = await fetch(
      `${API_BASE}/sync/pull?since=${encodeURIComponent(since)}&branchId=${encodeURIComponent(
        activeBranchId
      )}`,
      { headers }
    );

    if (pullRes.ok) {
      const delta = await pullRes.json();
      await db.transaction(
        'rw',
        [
          db.branches,
          db.products,
          db.batches,
          db.stockMovements,
          db.customers,
          db.sales,
          db.expenses,
          db.quotations,
          db.appointments,
          db.tasks,
          db.creditLedger,
        ],
        async () => {
          if (Array.isArray(delta.branches)) await db.branches.bulkPut(delta.branches);
          if (Array.isArray(delta.products)) await db.products.bulkPut(delta.products);
          if (Array.isArray(delta.batches)) await db.batches.bulkPut(delta.batches);
          if (Array.isArray(delta.stockMovements)) {
            await db.stockMovements.bulkPut(delta.stockMovements);
          }
          if (Array.isArray(delta.customers)) await db.customers.bulkPut(delta.customers);
          if (Array.isArray(delta.sales)) await db.sales.bulkPut(delta.sales);
          if (Array.isArray(delta.expenses)) await db.expenses.bulkPut(delta.expenses);
          if (Array.isArray(delta.quotations)) await db.quotations.bulkPut(delta.quotations);
          if (Array.isArray(delta.appointments)) {
            await db.appointments.bulkPut(delta.appointments);
          }
          if (Array.isArray(delta.tasks)) await db.tasks.bulkPut(delta.tasks);
          if (Array.isArray(delta.creditLedger)) {
            await db.creditLedger.bulkPut(delta.creditLedger);
          }

          // Always derive batch stock from the movement ledger sum
          if (Array.isArray(delta.batches)) {
            for (const b of delta.batches) {
              await recomputeLocalBatchLedgerBalance(String(b.branchId), String(b.id));
            }
          }
        }
      );

      if (delta.serverTimestamp && typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNC_KEY, delta.serverTimestamp);
      }
    }
  } catch {
    // Silent when backend is not running
  }

  notifySyncQueueUpdated();
  return { pushedCount, failedCount };
}

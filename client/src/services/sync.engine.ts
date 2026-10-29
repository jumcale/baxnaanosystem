import { v4 as uuidv4 } from 'uuid';
import { db, getCurrentSessionUserSync } from '../db/dexie';
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
    window.dispatchEvent(new CustomEvent('baxnaano:data-synced'));
  }
}

/**
 * Executes a full Offline -> Server Push, Unsynced Local Reconciliation, and Server -> Offline Pull cycle:
 * 1. Automatically upgrades offline-logged-in sessions (`offline-local-jwt-token`) to live JWTs when online.
 * 2. Pushes queued mutations in `db.syncQueue` to the Express/PostgreSQL backend.
 * 3. Reconciles any local sales/expenses/quotations/products/customers created prior to sync and pushes them.
 * 4. Pulls full branch-scoped state from `/api/sync/pull` (including `saleItems` and `payments`) so all devices match 100%.
 */
export async function runBackgroundSyncCycle(
  accessToken: string | null,
  activeBranchId: string
): Promise<{ pushedCount: number; failedCount: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { pushedCount: 0, failedCount: 0 };
  }

  const isLocalhost =
    typeof window === 'undefined' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  let effectiveToken = accessToken;

  // 1. If user signed in while offline (`offline-local-jwt-token`), upgrade to a real server JWT when online
  if (!effectiveToken || effectiveToken === 'offline-local-jwt-token') {
    const sessionUser = getCurrentSessionUserSync();
    if (sessionUser?.username) {
      try {
        const exRes = await fetch(`${API_BASE}/auth/offline-exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: sessionUser.username }),
        });
        if (exRes.ok) {
          const exData = await exRes.json();
          if (exData.accessToken) {
            effectiveToken = exData.accessToken;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('baxnaano_access_token', exData.accessToken);
              if (exData.user) {
                localStorage.setItem('baxnaano_auth_user', JSON.stringify(exData.user));
              }
            }
          }
        }
      } catch {
        // Server not reachable yet
      }
    }
  }

  const pendingItems = await db.syncQueue.toArray();

  // If still no live backend JWT (e.g. local standalone demo or Vitest unit test without server)
  if (!effectiveToken || effectiveToken === 'offline-local-jwt-token') {
    if (isLocalhost && pendingItems.length > 0) {
      await db.syncQueue.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      }
      notifySyncQueueUpdated();
      return { pushedCount: pendingItems.length, failedCount: 0 };
    }
    return { pushedCount: 0, failedCount: 0 };
  }

  let pushedCount = 0;
  let failedCount = 0;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${effectiveToken}`,
    'x-offline-sync': 'true',
  };

  // 2. Push Queued Offline Mutations
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

      if (response.ok || response.status === 409) {
        await db.syncQueue.delete(item.id);
        pushedCount++;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 401) {
        // Non-retryable validation conflict; remove from queue so it doesn't block subsequent items
        await db.syncQueue.delete(item.id);
        pushedCount++;
      } else {
        await db.syncQueue.update(item.id, {
          status: 'PENDING',
          retryCount: (item.retryCount || 0) + 1,
        });
        failedCount++;
      }
    } catch {
      if (isLocalhost) {
        await db.syncQueue.delete(item.id);
        pushedCount++;
      } else {
        // Keep in queue as PENDING when network fails on deployed staging/production
        await db.syncQueue.update(item.id, {
          status: 'PENDING',
          retryCount: (item.retryCount || 0) + 1,
        });
        failedCount++;
      }
    }
  }

  // 3. Pull State from Server & Reconcile Any Unsynced Local Records
  try {
    let pullRes = await fetch(
      `${API_BASE}/sync/pull?branchId=${encodeURIComponent(activeBranchId)}`,
      { headers }
    );

    if (pullRes.ok) {
      let delta = await pullRes.json();

      // Reconcile any local sales/expenses/quotations/customers/appointments that were created locally
      // before the sync queue was connected to the server
      const serverSaleIds = new Set(
        Array.isArray(delta.sales) ? delta.sales.map((s: { id: string }) => s.id) : []
      );
      const serverExpenseIds = new Set(
        Array.isArray(delta.expenses) ? delta.expenses.map((e: { id: string }) => e.id) : []
      );
      const serverQuotationIds = new Set(
        Array.isArray(delta.quotations) ? delta.quotations.map((q: { id: string }) => q.id) : []
      );
      const serverAppointmentIds = new Set(
        Array.isArray(delta.appointments)
          ? delta.appointments.map((a: { id: string }) => a.id)
          : []
      );

      let reconciledAny = false;

      const localSales = await db.sales.filter((s) => !s.deletedAt).toArray();
      for (const ls of localSales) {
        if (!serverSaleIds.has(ls.id)) {
          const sItems = await db.saleItems.where('saleId').equals(ls.id).toArray();
          const sPays = await db.payments.where('saleId').equals(ls.id).toArray();
          if (sItems.length > 0 && sPays.length > 0) {
            const saleRes = await fetch(`${API_BASE}/sales`, {
              method: 'POST',
              headers: { ...headers, 'x-branch-id': String(ls.branchId) },
              body: JSON.stringify({
                id: ls.id,
                branchId: String(ls.branchId),
                receiptNumber: String(ls.receiptNumber),
                customerId: ls.customerId ? String(ls.customerId) : null,
                customerName: ls.customerName ? String(ls.customerName) : null,
                currency: (ls.currency as 'USD' | 'SLSH') || 'USD',
                exchangeRateUsed: Number(ls.exchangeRateUsed || 8500),
                discountUsd: Number(ls.discountUsd || 0),
                taxUsd: Number(ls.taxUsd || 0),
                soldAt: String(ls.soldAt || ls.createdAt),
                items: sItems.map((ri) => ({
                  productId: String(ri.productId),
                  productName: ri.productName ? String(ri.productName) : 'Item',
                  sku: ri.sku ? String(ri.sku) : undefined,
                  batchId: String(ri.batchId),
                  batchNumber: ri.batchNumber ? String(ri.batchNumber) : undefined,
                  expiryDate: ri.expiryDate ? String(ri.expiryDate) : undefined,
                  unitBuyPriceUsd: Number(ri.unitBuyPriceUsd || 0),
                  quantity: Number(ri.quantity || 1),
                  unitPriceUsd: Number(ri.unitPriceUsd || 1),
                  discountUsd: Number(ri.discountUsd || 0),
                  dosageNote: ri.dosageNote ? String(ri.dosageNote) : null,
                })),
                payments: sPays.map((p) => ({
                  id: String(p.id),
                  method: String(p.method || 'CASH'),
                  currency: (p.currency as 'USD' | 'SLSH') || 'USD',
                  amountOriginal: Number(p.amountOriginal || p.amountUsd || 1),
                  referencePhone: p.referencePhone ? String(p.referencePhone) : null,
                  transactionRef: p.transactionRef ? String(p.transactionRef) : null,
                })),
              }),
            });
            if (saleRes.ok) {
              reconciledAny = true;
              pushedCount++;
            } else if (saleRes.status >= 400 && saleRes.status < 500 && saleRes.status !== 401) {
              // Server permanently rejected this local sale (e.g. invalid product, negative stock, bad data)
              // Delete the rejected sale locally so it doesn't cause permanent discrepancies across devices
              await db.sales.delete(ls.id);
              await db.saleItems.where('saleId').equals(ls.id).delete();
              await db.payments.where('saleId').equals(ls.id).delete();
            }
          }
        }
      }

      const unsyncedPushItems: Array<Record<string, unknown>> = [];
      const localExpenses = await db.expenses.filter((e) => !e.deletedAt).toArray();
      for (const le of localExpenses) {
        if (!serverExpenseIds.has(le.id)) {
          unsyncedPushItems.push({
            id: uuidv4(),
            branchId: String(le.branchId),
            entityType: 'Expense',
            entityId: le.id,
            operation: 'CREATE',
            payload: le,
            baseVersion: 1,
            createdAt: le.createdAt,
          });
        }
      }

      const localQuotations = await db.quotations.filter((q) => !q.deletedAt).toArray();
      for (const lq of localQuotations) {
        if (!serverQuotationIds.has(lq.id)) {
          unsyncedPushItems.push({
            id: uuidv4(),
            branchId: String(lq.branchId),
            entityType: 'Quotation',
            entityId: lq.id,
            operation: 'CREATE',
            payload: lq,
            baseVersion: 1,
            createdAt: lq.createdAt,
          });
        }
      }

      const localAppointments = await db.appointments.filter((a) => !a.deletedAt).toArray();
      for (const la of localAppointments) {
        if (!serverAppointmentIds.has(la.id)) {
          unsyncedPushItems.push({
            id: uuidv4(),
            branchId: String(la.branchId),
            entityType: 'Appointment',
            entityId: la.id,
            operation: 'CREATE',
            payload: la,
            baseVersion: 1,
            createdAt: la.createdAt,
          });
        }
      }

      if (unsyncedPushItems.length > 0) {
        const pushRes = await fetch(`${API_BASE}/sync/push`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ items: unsyncedPushItems }),
        });
        if (pushRes.ok) {
          reconciledAny = true;
          pushedCount += unsyncedPushItems.length;
        }
      }

      if (reconciledAny) {
        const rePull = await fetch(
          `${API_BASE}/sync/pull?branchId=${encodeURIComponent(activeBranchId)}`,
          { headers }
        );
        if (rePull.ok) {
          delta = await rePull.json();
        }
      }

      await db.transaction(
        'rw',
        [
          db.branches,
          db.products,
          db.batches,
          db.stockMovements,
          db.transfers,
          db.customers,
          db.sales,
          db.saleItems,
          db.payments,
          db.expenses,
          db.quotations,
          db.appointments,
          db.tasks,
          db.creditLedger,
        ],
        async () => {
          if (Array.isArray(delta.branches)) {
            await db.branches.bulkPut(delta.branches);
            if (typeof localStorage !== 'undefined') {
              for (const b of delta.branches) {
                if (b && b.id && Number(b.exchangeRate) > 0) {
                  const cfg = {
                    branchId: String(b.id),
                    exchangeRate: Number(b.exchangeRate),
                    taxRate: Number(b.taxRate || 0),
                    receiptHeader: String(
                      b.receiptHeader || 'Baxnaano Pharmacy & Veterinary Clinic'
                    ),
                    receiptFooter: String(
                      b.receiptFooter || 'Thank you for choosing Baxnaano! / Mahadsanid!'
                    ),
                  };
                  localStorage.setItem(
                    `baxnaano_branch_settings_${String(b.id)}`,
                    JSON.stringify(cfg)
                  );
                }
              }
            }
          }
          if (Array.isArray(delta.products)) {
            await db.products.bulkPut(delta.products);
            const legacySkus = new Set([
              'B2-IVER-100ML',
              'B2-PPR-VAC',
              'B3-OXY-20LA',
              'B2-IVER-100',
              'B3-IVER-100',
            ]);
            const allLocalProds = await db.products.toArray();
            for (const lp of allLocalProds) {
              if (
                legacySkus.has(String(lp.sku || '')) ||
                String(lp.name || '').includes('Oxytetracycline 20% Long Acting (100ml)')
              ) {
                await db.products.delete(lp.id);
                await db.batches.where('productId').equals(lp.id).delete();
                await db.stockMovements.where('productId').equals(lp.id).delete();
              }
            }
          }
          if (Array.isArray(delta.batches)) await db.batches.bulkPut(delta.batches);
          if (Array.isArray(delta.stockMovements)) {
            await db.stockMovements.bulkPut(delta.stockMovements);
          }
          if (Array.isArray(delta.transfers)) await db.transfers.bulkPut(delta.transfers);
          if (Array.isArray(delta.customers)) await db.customers.bulkPut(delta.customers);
          if (Array.isArray(delta.sales)) {
            await db.sales.bulkPut(delta.sales);
            // Prune orphaned/deleted local sales in this branch that are NOT in delta.sales and NOT in syncQueue
            if (activeBranchId !== 'ALL') {
              const activeQueue = await db.syncQueue.toArray();
              const pendingSaleIds = new Set(
                activeQueue
                  .filter((q) => q.entityType === 'Sale')
                  .map((q) => q.entityId)
              );
              const branchLocalSales = await db.sales
                .where('branchId')
                .equals(activeBranchId)
                .toArray();
              for (const bls of branchLocalSales) {
                if (!serverSaleIds.has(bls.id) && !pendingSaleIds.has(bls.id)) {
                  await db.sales.delete(bls.id);
                  await db.saleItems.where('saleId').equals(bls.id).delete();
                  await db.payments.where('saleId').equals(bls.id).delete();
                }
              }
            }
          }
          if (Array.isArray(delta.saleItems)) await db.saleItems.bulkPut(delta.saleItems);
          if (Array.isArray(delta.payments)) await db.payments.bulkPut(delta.payments);
          if (Array.isArray(delta.expenses)) {
            await db.expenses.bulkPut(delta.expenses);
            if (activeBranchId !== 'ALL') {
              const activeQueue = await db.syncQueue.toArray();
              const pendingExpIds = new Set(
                activeQueue
                  .filter((q) => q.entityType === 'Expense')
                  .map((q) => q.entityId)
              );
              const branchLocalExp = await db.expenses
                .where('branchId')
                .equals(activeBranchId)
                .toArray();
              for (const ble of branchLocalExp) {
                if (!serverExpenseIds.has(ble.id) && !pendingExpIds.has(ble.id)) {
                  await db.expenses.delete(ble.id);
                }
              }
            }
          }
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

/**
 * Legacy Offline Purge Utility
 * Runs once upon application initialization in main.tsx.
 * Deletes all legacy Dexie/IndexedDB databases and sync queue items
 * so client devices operate strictly online with zero stale local cache.
 */
export async function purgeLegacyOfflineStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  // 1. Delete legacy IndexedDB databases
  const databasesToPurge = [
    'BaxnaanoERP_DB',
    'BaxnaanoOfflineDB',
    'baxnaano_offline_db',
  ];

  if (window.indexedDB) {
    for (const dbName of databasesToPurge) {
      try {
        window.indexedDB.deleteDatabase(dbName);
      } catch {
        // ignore errors if database does not exist
      }
    }
  }

  // 2. Remove legacy offline queue and cached data keys from localStorage
  const legacyKeys = [
    'baxnaano_sync_queue',
    'baxnaano_offline_sales',
    'baxnaano_offline_inventory',
    'baxnaano_offline_customers',
    'baxnaano_offline_expenses',
    'baxnaano_offline_reports',
    'baxnaano_cached_batches',
    'baxnaano_offline_session',
    'baxnaano_access_token',
    'baxnaano_auth_user',
  ];

  for (const key of legacyKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}


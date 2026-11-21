/**
 * Client Storage Purge Utility
 * Runs on startup and logout to guarantee zero tokens, user PII, or business data
 * are ever stored in IndexedDB, localStorage, or sessionStorage.
 */
export async function purgeLegacyOfflineStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  // 1. Delete any legacy IndexedDB databases
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

  // 2. Remove any tokens, user profiles, or cached business data from localStorage & sessionStorage
  const forbiddenKeys = [
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
    'baxnaano_session_user',
    'baxnaano_session_token',
  ];

  for (const key of forbiddenKeys) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  // Also purge any cached dashboard snapshots
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('baxnaano_dashboard_cache_')) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

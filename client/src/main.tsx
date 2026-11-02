import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { purgeLegacyOfflineStorage } from './lib/legacyCleanup';
import { registerSW } from 'virtual:pwa-register';

// Register PWA Service Worker for standalone installation and asset caching
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New version ready.');
  },
  onOfflineReady() {
    console.log('[PWA] Baxnaano app ready for standalone installation.');
  },
});

// Purge obsolete Dexie/IndexedDB databases and sync queue items
purgeLegacyOfflineStorage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

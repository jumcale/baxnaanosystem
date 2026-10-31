import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { purgeLegacyOfflineStorage } from './lib/legacyCleanup';

// Purge obsolete Dexie/IndexedDB databases and sync queue items
purgeLegacyOfflineStorage();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

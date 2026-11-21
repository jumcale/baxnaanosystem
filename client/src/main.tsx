import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { purgeLegacyOfflineStorage } from './lib/legacyCleanup';
import { registerSW } from 'virtual:pwa-register';

// 1. Mount React UI Shell immediately on the main thread (never block first paint!)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// 2. Defer Service Worker registration and legacy IndexedDB cleanup until after first paint
const runPostPaintTasks = () => {
  purgeLegacyOfflineStorage();

  registerSW({
    immediate: false,
    onNeedRefresh() {
      console.log('[PWA] New version ready.');
    },
    onOfflineReady() {
      console.log('[PWA] Baxnaano app shell cached for instant startup.');
    },
  });
};

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') {
    setTimeout(runPostPaintTasks, 200);
  } else {
    window.addEventListener(
      'load',
      () => {
        setTimeout(runPostPaintTasks, 200);
      },
      { once: true }
    );
  }
}

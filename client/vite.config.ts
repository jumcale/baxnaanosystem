import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'baxnaano-logo.jpg',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
        'apple-touch-icon.png',
        'favicon-32x32.png',
      ],
      manifest: {
        id: '/',
        name: 'Baxnaano Pharmacy & Veterinary System',
        short_name: 'Baxnaano',
        description: 'Baxnaano Multi-Branch Pharmacy & Veterinary ERP & POS Management System',
        theme_color: '#059669',
        background_color: '#0f172a',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'medical'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Pure Online-Only: No caching of /api/ endpoints to prevent stale data
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
  },
});

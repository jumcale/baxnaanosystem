import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is handled explicitly after window.load in main.tsx so it never blocks first paint
      injectRegister: null,
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
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'baxnaano-static-media-v1',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-i18n': ['i18next', 'react-i18next'],
          'vendor-icons': ['lucide-react'],
          'vendor-pdf': ['jspdf'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});

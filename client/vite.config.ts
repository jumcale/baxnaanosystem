import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['baxnaano-logo.jpg', 'favicon.svg', 'robots.txt'],
      manifest: {
        name: 'Baxnaano Pharmacy & Veterinary System',
        short_name: 'Baxnaano POS',
        description: 'Online Multi-Branch Pharmacy & Veterinary Management System (Arabsiyo & Gabiley)',
        theme_color: '#059669',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/baxnaano-logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
          },
          {
            src: '/baxnaano-logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff2}'],
        // Pure Online-Only: No caching of /api/ endpoints to prevent stale data
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});

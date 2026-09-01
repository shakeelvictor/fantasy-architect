import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable + assets cached for flaky draft-night wifi. Deliberately
    // NOT an offline command queue: writes are server-authoritative and fail
    // LOUDLY when the network is gone — v1's lesson that loud beats clever.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /\/players\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'players' },
          },
        ],
      },
      manifest: {
        name: 'Fantasy Architect',
        short_name: 'FA',
        description: 'INDOMEXPAK draft room',
        theme_color: '#0d1220',
        background_color: '#0d1220',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});

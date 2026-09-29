import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = 'https://nadezhdik.ru';

// Старые страницы из Tilda лежат в public/ и не видны Astro — добавляем их в sitemap вручную.
const legacyPages = ['/', '/english/', '/school/', '/dance/', '/football/'].map((p) => site + p);

export default defineConfig({
  site,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  // В dev-режиме заявки с форм уходят в локальный server/lead-handler.mjs (npm run leads:dev).
  vite: { server: { proxy: { '/api': 'http://127.0.0.1:8787' } } },
  integrations: [
    sitemap({
      customPages: legacyPages,
      filter: (page) => !page.includes('/styleguide'),
    }),
  ],
});

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// Four entry points, one output folder that Chrome loads unpacked:
//   sidepanel.html / options.html  extension pages (Vue)
//   background.js                  service worker (ES module)
//   content.js                     content script: must stay import-free,
//                                  because content scripts are not modules.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        sidepanel: resolve(import.meta.dirname, 'sidepanel.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
        content: resolve(import.meta.dirname, 'src/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

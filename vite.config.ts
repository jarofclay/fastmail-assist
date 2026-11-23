import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Used by Vitest only. The extension itself is built by scripts/build.mjs,
// which runs Vite once for the pages and once each for the background worker
// and the content script.
export default defineConfig({
  plugins: [vue()],
  define: { __FA_OPEN_SHADOW__: 'false' },
});

// Builds dist/chrome and dist/firefox.
//
//   node scripts/build.mjs           production build of both
//   node scripts/build.mjs --watch   rebuild on every change under src/
//
// The extension pages (side panel, settings) are one Vite build. The
// background worker and the content script are each bundled on their own into
// a single classic script, because neither browser loads them as modules with
// shared chunks.

import { cp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { build } from 'vite';
import { manifest } from './manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = (...parts) => resolve(root, 'dist', ...parts);
const target = ['chrome116', 'firefox128'];
const define = { __FA_OPEN_SHADOW__: JSON.stringify(process.env.FA_E2E === '1') };

async function buildAll() {
  const started = Date.now();
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await rm(dist(), { recursive: true, force: true });

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    plugins: [vue()],
    define,
    build: {
      outDir: dist('chrome'),
      emptyOutDir: true,
      target,
      rollupOptions: {
        input: { sidepanel: resolve(root, 'sidepanel.html'), options: resolve(root, 'options.html') },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  });

  for (const name of ['background', 'content']) {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      publicDir: false,
      define,
      build: {
        outDir: dist('chrome'),
        emptyOutDir: false,
        target,
        rollupOptions: {
          input: resolve(root, `src/${name}.ts`),
          output: { format: 'iife', entryFileNames: `${name}.js` },
        },
      },
    });
    const code = await readFile(dist('chrome', `${name}.js`), 'utf8');
    if (/^\s*(import|export)\s/m.test(code)) throw new Error(`dist/chrome/${name}.js must be a classic script, but contains import/export.`);
  }

  await cp(dist('chrome'), dist('firefox'), { recursive: true });
  for (const browser of ['chrome', 'firefox']) {
    await writeFile(dist(browser, 'manifest.json'), `${JSON.stringify(manifest(browser, version), null, 2)}\n`);
  }
  console.log(`Built dist/chrome and dist/firefox (v${version}) in ${Date.now() - started} ms`);
}

await buildAll();

if (process.argv.includes('--watch')) {
  console.log('Watching src/ …');
  let timer;
  for await (const _ of watch(resolve(root, 'src'), { recursive: true })) {
    clearTimeout(timer);
    timer = setTimeout(() => buildAll().catch((error) => console.error(error.message)), 150);
  }
}

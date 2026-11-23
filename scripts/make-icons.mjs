// Renders public/icons/icon-*.png from the SVG below. Run it only when the
// icon changes; the PNGs are committed. Needs Playwright with Chromium:
//   node scripts/make-icons.mjs
//
// The mark is a reply arrow with a sparkle: Fastmail's Reply, with the AI
// flair. The same two paths are used at 24px in src/content.ts and the Vue
// pages.

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// require() finds a globally installed Playwright; import does not.
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2456e6"/><stop offset="1" stop-color="#7a4bf0"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <g fill="#fff" transform="translate(64 66) scale(4.3) translate(-12 -12)">
    <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
    <path d="M19 1.6Q19 5 22.4 5Q19 5 19 8.4Q19 5 15.6 5Q19 5 19 1.6Z"/>
    <path d="M14.2 1.2Q14.2 3 16 3Q14.2 3 14.2 4.8Q14.2 3 12.4 3Q14.2 3 14.2 1.2Z" opacity="0.85"/>
  </g>
</svg>`;

const out = resolve(import.meta.dirname, '..', 'public', 'icons');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'icon.svg'), svg);

const browser = await chromium.launch();
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: resolve(out, `icon-${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
console.log('Wrote public/icons');

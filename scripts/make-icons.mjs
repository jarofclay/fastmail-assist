// Renders public/icons/icon-*.png from the SVG below. Run it only when the
// icon changes; the PNGs are committed. Needs Playwright with Chromium:
//   node scripts/make-icons.mjs

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
  <g fill="#fff" transform="translate(64 64) scale(4.6) translate(-11.2 -11.2)">
    <path d="M10 2.5l1.7 4.9a2 2 0 0 0 1.2 1.2l4.9 1.7-4.9 1.7a2 2 0 0 0-1.2 1.2L10 18.1l-1.7-4.9a2 2 0 0 0-1.2-1.2L2.2 10.3l4.9-1.7a2 2 0 0 0 1.2-1.2z"/>
    <path d="M18.5 14.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>
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

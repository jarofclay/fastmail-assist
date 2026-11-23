// Composes the store screenshots (1280×800) and the Chrome small promo tile
// (440×280) from the browser test's screenshots, so they show the extension's
// own UI and nothing pretending to be Fastmail. Needs Playwright with Chromium.
//
//   FA_SHOTS=/tmp/fa-shots npm run e2e      (xvfb-run -a on Linux without a display)
//   node scripts/store-assets.mjs /tmp/fa-shots
//
// Writes store/screenshots/.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const shots = process.argv[2];
if (!shots) {
  console.error('Usage: node scripts/store-assets.mjs <dir written by FA_SHOTS=dir npm run e2e>');
  process.exit(2);
}
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'store', 'screenshots');
await mkdir(out, { recursive: true });

const png = async (name) => `data:image/png;base64,${(await readFile(resolve(shots, name))).toString('base64')}`;
const iconSvg = `data:image/svg+xml;base64,${(await readFile(resolve(root, 'public', 'icons', 'icon.svg'))).toString('base64')}`;

const CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body { font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #fff; background: linear-gradient(135deg, #1d47c9 0%, #2456e6 45%, #7a4bf0 100%); overflow: hidden; }
  .shot { position: relative; width: 1280px; height: 800px; display: flex; align-items: center; gap: 56px; padding: 0 72px; }
  .text { flex: 1; min-width: 0; }
  .eyebrow { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; font-size: 17px; opacity: 0.9; margin-bottom: 22px; }
  .eyebrow img { width: 30px; height: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); }
  h1 { font-size: 46px; line-height: 1.1; font-weight: 750; letter-spacing: -0.5px; margin-bottom: 22px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: 19px; opacity: 0.95; }
  li { display: flex; gap: 12px; align-items: flex-start; }
  li::before { content: ''; flex: none; width: 9px; height: 9px; margin-top: 10px; border-radius: 50%; background: #fff; opacity: 0.85; }
  .art { flex: none; display: flex; align-items: center; justify-content: center; }
  .art img { display: block; border-radius: 16px; box-shadow: 0 24px 60px rgba(10, 16, 40, 0.45), 0 2px 6px rgba(10, 16, 40, 0.3); }
  .tile { width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; }
  .tile img { width: 88px; height: 88px; border-radius: 22px; box-shadow: 0 10px 28px rgba(0,0,0,0.3); }
  .tile b { font-size: 30px; font-weight: 750; letter-spacing: -0.3px; }
  .tile span { font-size: 16px; opacity: 0.9; }
`;

/**
 * One 1280×800 screenshot: text on the left, a picture of the UI on the
 * right. `size` is a CSS size for the picture: a height for the tall cards,
 * a width for wide pages, so the text column keeps its room.
 */
const screen = (title, bullets, image, size) => `
  <div class="shot">
    <div class="text">
      <div class="eyebrow"><img src="${iconSvg}" alt="">Fastmail Assist</div>
      <h1>${title}</h1>
      <ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
    </div>
    <div class="art"><img src="${image}" style="${size}" alt=""></div>
  </div>`;

const pages = [
  ['1-reply.jpg', screen('Reply with AI, right inside Fastmail', [
    'Say in a line what the reply should say.',
    'It reads the whole conversation, not just the last message.',
    'The draft streams in, in your own voice.',
    'You review and send in Fastmail. It never sends.',
  ], await png('card-reply.png'), 'height:680px')],
  ['2-knows-who.jpg', screen('It knows who you are writing to', [
    'To suggests people from your Fastmail contacts and recent mail.',
    'Earlier conversations with them become background for the draft.',
    'Greetings use the right name. Nothing already agreed is repeated.',
  ], await png('card-to.png'), 'height:560px')],
  ['3-drafts-land.jpg', screen('Drafts land in Fastmail', [
    'Insert into the draft you have open, above the quote and signature.',
    'Or Save to Drafts, threaded onto the conversation.',
    'Ask for changes: shorter, warmer, in German.',
  ], await png('card-new.png'), 'height:700px')],
  ['4-side-panel.jpg', screen('A side panel, when you want more room', [
    'The same flow, with a list of recent conversations.',
    'Keeps your work in progress if you close it.',
    'Chrome side panel, Firefox sidebar.',
  ], await png('panel.png'), 'height:700px')],
  ['5-your-keys.jpg', screen('Your keys. Your browser. No server.', [
    'Your own Fastmail API token and Claude API key, stored locally.',
    'Talks only to api.fastmail.com and api.anthropic.com.',
    'No account with us, no analytics, nothing collected.',
    'Open source, MIT licensed.',
  ], await png('settings.png'), 'width:640px')],
];

const browser = await chromium.launch();
for (const [name, body] of pages) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>${CSS}</style>${body}`);
  // JPEG: a gradient background makes PNGs several times larger, and both stores take JPEG.
  await page.screenshot({ path: resolve(out, name), type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`Wrote store/screenshots/${name}`);
}
{
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>${CSS}</style><div class="tile"><img src="${iconSvg}" alt=""><b>Fastmail Assist</b><span>Reply with AI, inside Fastmail. Never sends.</span></div>`);
  await page.screenshot({ path: resolve(out, 'promo-small-440x280.png') });
  await page.close();
  console.log('Wrote store/screenshots/promo-small-440x280.png');
}
await browser.close();
await writeFile(resolve(out, 'README.md'), `# Store screenshots

Generated by \`node scripts/store-assets.mjs <shots dir>\` from the browser test's screenshots (\`FA_SHOTS=<dir> npm run e2e\`). Do not edit by hand.

| File | Size | Use |
| --- | --- | --- |
| 1-reply.jpg … 5-your-keys.jpg | 1280×800 | Screenshots, both stores, in this order |
| promo-small-440x280.png | 440×280 | Chrome Web Store small promo tile |
`);

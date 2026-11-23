// End-to-end smoke test: loads the built Chrome extension into Chromium and
// drives it against the stand-in server in server.mjs. No real account, key
// or mail is involved.
//
//   npm run e2e                       (builds with FA_E2E=1, then runs this)
//   FA_SHOTS=some/dir npm run e2e     also writes screenshots there
//
// Needs Playwright with Chromium available to require(); it is not a
// dependency of this project. A display is needed too (xvfb-run on Linux).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EMAIL_ID, THREAD_ID, startServer } from './server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(import.meta.dirname, '..', '..');
const extension = resolve(root, 'dist', 'chrome');
const shots = process.env.FA_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const server = await startServer();
const hosts = ['app.fastmail.com', 'api.fastmail.com', 'api.anthropic.com'];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fa-profile-')), {
  channel: 'chromium',
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: shots ? 2 : 1,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--host-resolver-rules=${hosts.map((h) => `MAP ${h}:443 127.0.0.1:${server.port}`).join(', ')}`,
    '--ignore-certificate-errors',
    '--no-proxy-server',
  ],
});

const steps = [];
const step = async (name, run) => {
  await run();
  steps.push(name);
  console.log(`  ok  ${name}`);
};
const shot = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const errors = [];
  context.on('weberror', (e) => errors.push(String(e.error())));

  // --- Settings page ---
  const options = await context.newPage();
  options.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await options.goto(`chrome-extension://${id}/options.html`);
  await step('settings: save keys and an identity, both connection tests pass', async () => {
    await options.fill('#token', 'test-token');
    await options.fill('#key', 'test-key');
    await options.getByRole('button', { name: 'Add identity' }).click();
    await options.fill('#name-0', 'Sam & Alex');
    await options.fill('#email-0', 'us@example.org');
    await options.fill('#voice-0', 'Warm and brief. First names.');
    await options.getByRole('button', { name: 'Save settings' }).click();
    await options.getByText('Saved.', { exact: true }).waitFor();
    const tests = options.getByRole('button', { name: 'Test connection' });
    await tests.nth(0).click();
    await options.getByText('The inbox is readable.').waitFor();
    await tests.nth(1).click();
    await options.getByText('claude-sonnet-5-5 answered.').waitFor();
  });
  await shot(options, 'settings');

  // --- Inside the mail page ---
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('https://app.fastmail.com/mail/Inbox/?u=1a2b3c4d');
  const fa = page.locator('#fastmail-assist-root');

  await step('launcher is shown and follows the open conversation', async () => {
    await fa.locator('.launcher').getByText('Draft with AI').waitFor();
    await page.click('#open');
    await fa.locator('.launcher').getByText('Reply with AI').waitFor();
  });

  await step('"Reply with AI" appears next to the Reply button', async () => {
    const button = page.locator('[data-fastmail-assist]');
    await button.waitFor();
    assert.equal(await button.evaluate((el) => el.previousElementSibling.id), 'reply');
  });
  await shot(page, 'conversation');

  await step('composer opens with the conversation looked up over JMAP', async () => {
    await page.locator('[data-fastmail-assist]').click();
    await fa.locator('.title').getByText('Reply to Dana Lee').waitFor();
    assert.match(await fa.locator('.sub').textContent(), /Dinner on the 12th\? · 2 messages/);
  });

  await step('typing in the composer does not trigger the page\'s shortcuts', async () => {
    await fa.locator('.instruction').click();
    await page.keyboard.type('yes to the 12th, we bring dessert, ask about 7pm');
    assert.deepEqual(await page.evaluate(() => window.shortcutsFired), []);
    assert.equal(await fa.locator('.instruction').inputValue(), 'yes to the 12th, we bring dessert, ask about 7pm');
  });

  await step('draft streams in', async () => {
    await page.keyboard.press('Control+Enter');
    await fa.getByRole('button', { name: 'Stop' }).waitFor();
    await fa.getByRole('button', { name: /Draft again/ }).waitFor();
    assert.match(await fa.locator('.draft').inputValue(), /^Hi Dana,[\s\S]*Sam & Alex$/);
  });
  await shot(page, 'composer-draft');

  await step('revise sends the draft on screen back with the change', async () => {
    await fa.locator('input[type=text]').fill('shorter');
    await page.keyboard.press('Enter');
    await fa.getByRole('button', { name: /Draft again/ }).waitFor();
    const last = server.state.claudeRequests.at(-1).body.messages;
    assert.equal(last.length, 3);
    assert.equal(last[2].content, 'Revise the draft: shorter');
    assert.match(await fa.locator('.draft').inputValue(), /Yes to the 12th/);
  });

  await step('Save to Drafts creates a threaded draft and never touches sending', async () => {
    await fa.getByRole('button', { name: 'Save to Drafts' }).click();
    await fa.getByText('Saved to Drafts').waitFor();
    const draft = server.state.drafts.at(-1);
    assert.deepEqual(draft.keywords, { $draft: true, $seen: true });
    assert.deepEqual(draft.mailboxIds, { 'mb-drafts': true });
    assert.deepEqual(draft.inReplyTo, ['c@example.com']);
    assert.deepEqual(draft.to, [{ name: 'Dana Lee', email: 'dana@example.com' }]);
    assert.equal(await fa.locator('.status a').getAttribute('href'), 'https://app.fastmail.com/mail/Drafts/?u=1a2b3c4d');
  });

  await step('clicking Reply in the page offers Insert, which writes into the Squire editor', async () => {
    await page.click('#reply');
    await fa.getByRole('button', { name: 'Insert into draft' }).waitFor();
    await shot(page, 'composer-insert');
    await fa.getByRole('button', { name: 'Insert into draft' }).click();
    await fa.locator('.toast').waitFor();
    // Squire took the paste: one block per line, blank lines kept, quote untouched.
    const html = await page.locator('#editor').innerHTML();
    assert.ok(html.startsWith('<div>Hi Dana,</div><div><br></div><div>Yes to the 12th, and we will bring dessert.</div><div><br></div><div>Sam &amp; Alex</div>'), html);
    assert.ok(html.endsWith('<blockquote><div>Any news? Also, can you bring dessert?</div></blockquote>'), html);
    assert.equal(await fa.locator('.card').isVisible(), false);
  });
  await shot(page, 'inserted');

  await step('the chip in the draft editor opens the composer too', async () => {
    await page.locator('#editor').click();
    await fa.locator('.chip').click();
    await fa.locator('.title').getByText('Reply to Dana Lee').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await fa.locator('.card').isVisible(), false);
  });

  await step('saving settings updates a composer that is already open', async () => {
    await fa.locator('.launcher').click();
    await fa.locator('.title').getByText('Reply to Dana Lee').waitFor();
    await options.bringToFront();
    await options.getByRole('button', { name: 'Add identity' }).click();
    await options.fill('#name-1', 'Sam');
    await options.fill('#email-1', 'sam@example.org');
    await options.getByRole('button', { name: 'Save settings' }).click();
    await options.getByText('Saved.', { exact: true }).waitFor();
    await page.bringToFront();
    await fa.locator('select option[value="sam@example.org"]').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
  });

  await step('with no conversation, it drafts a new email with a subject', async () => {
    await page.click('#back');
    await fa.locator('.launcher').click();
    await fa.locator('.title').getByText('New email').waitFor();
    await fa.locator('.instruction').fill('invite Dana to dinner on Friday');
    await fa.getByRole('button', { name: /^Draft/ }).click();
    await fa.getByRole('button', { name: /Draft again/ }).waitFor();
    assert.equal(await fa.locator('.subject b').textContent(), 'Dinner on Friday');
    assert.doesNotMatch(await fa.locator('.draft').inputValue(), /Subject:/);
  });
  await shot(page, 'composer-new');

  // --- Side panel (opened as a tab; Playwright cannot open the real panel) ---
  const panel = await context.newPage();
  panel.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await step('side panel: pick a recent conversation, draft, save', async () => {
    await panel.getByText('Dana Lee').first().click();
    await panel.getByText('Replying to Dana Lee').waitFor();
    await panel.fill('#instruction', 'yes, and we bring dessert');
    await panel.getByRole('button', { name: /^Draft/ }).click();
    await panel.getByRole('button', { name: /Draft again/ }).waitFor();
    assert.match(await panel.locator('#draft').inputValue(), /^Hi Dana,/);
    await shot(panel, 'panel');
    const before = server.state.drafts.length;
    await panel.getByRole('button', { name: 'Save to Drafts' }).click();
    await panel.getByText('Saved to Drafts').waitFor();
    assert.equal(server.state.drafts.length, before + 1);
  });

  await step('side panel keeps work in progress across a reload', async () => {
    await panel.fill('#instruction', 'a note to keep');
    await panel.waitForTimeout(500);
    await panel.reload();
    await panel.getByText('Replying to Dana Lee').waitFor();
    assert.equal(await panel.inputValue('#instruction'), 'a note to keep');
    assert.match(await panel.locator('#draft').inputValue(), /^Hi Dana,/);
  });

  await step('requests carry only what they should', async () => {
    const jmap = JSON.stringify(server.state.jmapRequests);
    assert.ok(!jmap.includes('EmailSubmission') && !jmap.includes('submission') && !jmap.includes('Identity/'));
    for (const request of server.state.jmapRequests) {
      assert.deepEqual(request.using, ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']);
    }
    const claude = server.state.claudeRequests.find((r) => r.body.stream);
    assert.equal(claude.headers['x-api-key'], 'test-key');
    assert.equal(claude.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.match(claude.body.messages[0].content, /<thread>[\s\S]*<\/thread>/);
    assert.match(claude.body.system, /Warm and brief/);
    assert.ok(jmap.includes(THREAD_ID)); // the id came from the page URL
  });

  await step('no console errors on any page', async () => {
    assert.deepEqual(errors, []);
  });

  if (shots) {
    const dark = await context.newPage();
    await dark.goto(`https://app.fastmail.com/mail/Inbox/${THREAD_ID}.${EMAIL_ID}?u=1a2b3c4d&dark=1`);
    await dark.locator('[data-fastmail-assist]').click();
    const card = dark.locator('#fastmail-assist-root');
    await card.locator('.instruction').fill('yes to the 12th, we bring dessert');
    await card.getByRole('button', { name: /^Draft/ }).click();
    await card.getByRole('button', { name: /Draft again/ }).waitFor();
    await shot(dark, 'composer-dark');
  }

  console.log(`\n${steps.length} steps passed.`);
} finally {
  await context.close();
  server.close();
}

// A stand-in for the three hosts the extension talks to, for the smoke test.
// One local HTTPS server answers as app.fastmail.com (a small mail-like page
// using Squire, the editor Fastmail uses), api.fastmail.com (JMAP) and
// api.anthropic.com (a streamed Messages reply). All data here is made up.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

export const THREAD_ID = 'Tabc123def4567890';
export const EMAIL_ID = 'M0123456789abcdef01234567';

const emails = [
  {
    id: 'M0123456789abcdef01234500',
    threadId: THREAD_ID,
    from: [{ name: 'Dana Lee', email: 'dana@example.com' }],
    to: [{ name: 'Sam & Alex', email: 'us@example.org' }],
    cc: null,
    replyTo: null,
    subject: 'Dinner on the 12th?',
    receivedAt: '2026-11-10T09:00:00Z',
    messageId: ['a@example.com'],
    references: null,
    keywords: {},
    preview: 'Are you two free on the 12th?',
    textBody: [{ partId: '1', type: 'text/plain' }],
    bodyValues: { 1: { value: 'Hi both,\n\nAre you two free on the 12th? We would love to have you over.\n\nDana', isTruncated: false } },
  },
  {
    id: EMAIL_ID,
    threadId: THREAD_ID,
    from: [{ name: 'Dana Lee', email: 'dana@example.com' }],
    to: [{ name: 'Sam & Alex', email: 'us@example.org' }],
    cc: [{ email: 'lee@example.com' }],
    replyTo: null,
    subject: 'Re: Dinner on the 12th?',
    receivedAt: '2026-11-11T18:30:00Z',
    messageId: ['c@example.com'],
    references: ['a@example.com'],
    keywords: {},
    preview: 'Any news? Also, can you bring dessert?',
    textBody: [{ partId: '1', type: 'text/plain' }],
    bodyValues: { 1: { value: 'Any news? Also, can you bring dessert?\n\nDana', isTruncated: false } },
  },
];

const REPLY = 'Hi Dana,\n\nYes, the 12th works for us and we would love to come. We will bring dessert.\n\nWould 7pm suit you?\n\nSam & Alex';

function appPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inbox – Mock mail</title>
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: #1b2330; background: var(--bg, #fff); display: grid; grid-template-columns: 220px 1fr; height: 100vh; }
  body.dark { --bg: #14171d; color: #e6e9ef; }
  nav { background: #0f2a4a; color: #dbe6f5; padding: 16px; }
  nav b { display: block; margin-bottom: 14px; font-size: 16px; }
  main { padding: 18px 26px; overflow: auto; }
  .list button, .toolbar button, .send { font: inherit; padding: 6px 12px; border: 1px solid #c9d1dc; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
  .list button { display: block; width: 100%; text-align: left; margin-bottom: 8px; }
  .toolbar { display: flex; gap: 8px; margin: 12px 0; }
  .message { border: 1px solid #d9dee6; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; white-space: pre-wrap; }
  .compose { border: 1px solid #c9d1dc; border-radius: 8px; margin-top: 14px; }
  .compose .head { padding: 8px 12px; border-bottom: 1px solid #d9dee6; color: #667; }
  #editor { min-height: 180px; padding: 12px; outline: none; }
  #editor blockquote { margin: 8px 0; padding-left: 10px; border-left: 3px solid #b8c2d0; color: #667; }
</style></head><body>
<nav><b>Mock mail</b>Inbox<br>Drafts<br>Sent</nav>
<main>
  <div id="list" class="list"><h2>Inbox</h2><button id="open">Dana Lee · Dinner on the 12th?</button></div>
  <div id="thread" hidden>
    <h2>Dinner on the 12th?</h2>
    <div class="message">Hi both,\n\nAre you two free on the 12th? We would love to have you over.\n\nDana</div>
    <div class="message">Any news? Also, can you bring dessert?\n\nDana</div>
    <div class="toolbar"><button id="reply">Reply</button><button>Reply all</button><button>Forward</button><button id="back">Back</button></div>
    <div id="compose" class="compose" hidden><div class="head">To: Dana Lee</div><div id="editor"></div><div class="head"><button class="send">Send</button></div></div>
  </div>
</main>
<script src="/squire.js"></script>
<script>
  // Like a real mail app, single letters act on mail. The extension's composer
  // must keep its typing away from these.
  window.shortcutsFired = [];
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('#editor')) return;
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) window.shortcutsFired.push(e.key);
  });
  const sanitizeToDOMFragment = (html) => { const t = document.createElement('template'); t.innerHTML = html; return document.importNode(t.content, true); };
  const show = (thread) => { document.getElementById('list').hidden = thread; document.getElementById('thread').hidden = !thread; };
  const params = location.search;
  if (new URLSearchParams(params).has('dark')) document.body.classList.add('dark');
  document.getElementById('open').onclick = () => { history.pushState({}, '', '/mail/Inbox/${THREAD_ID}.${EMAIL_ID}' + params); show(true); };
  document.getElementById('back').onclick = () => { history.pushState({}, '', '/mail/Inbox/' + params); show(false); document.getElementById('compose').hidden = true; };
  document.getElementById('reply').onclick = () => {
    document.getElementById('compose').hidden = false;
    if (!window.squire) window.squire = new Squire(document.getElementById('editor'), { sanitizeToDOMFragment });
    window.squire.setHTML('<div><br></div><div><br></div><div>--<br>Sam &amp; Alex</div><blockquote><div>Any news? Also, can you bring dessert?</div></blockquote>');
    window.squire.focus(); window.squire.moveCursorToStart();
  };
  if (/[TM][0-9a-f]{8,}/.test(location.pathname)) show(true);
</script></body></html>`;
}

function jmap(body, state) {
  const results = {};
  const responses = [];
  for (const [name, args, callId] of body.methodCalls) {
    let result = {};
    const resolveIds = () => {
      if (args.ids) return args.ids;
      const ref = args['#ids'];
      if (!ref) return null;
      const source = results[ref.resultOf];
      if (ref.path === '/ids') return source.ids;
      if (ref.path === '/list/*/threadId') return source.list.map((e) => e.threadId);
      if (ref.path === '/list/*/emailIds') return source.list.flatMap((t) => t.emailIds);
      return null;
    };
    if (name === 'Mailbox/get') result = { list: [{ id: 'mb-inbox', role: 'inbox' }, { id: 'mb-drafts', role: 'drafts' }] };
    else if (name === 'Thread/get') result = { list: resolveIds().filter((id) => id === THREAD_ID).map((id) => ({ id, emailIds: emails.map((e) => e.id) })) };
    else if (name === 'Email/get') result = { list: emails.filter((e) => resolveIds().includes(e.id)) };
    else if (name === 'Email/query') result = { ids: [EMAIL_ID] };
    else if (name === 'Email/set') {
      state.drafts.push(args.create.draft);
      result = { created: { draft: { id: 'Mnewdraft00000001' } } };
    }
    results[callId] = result;
    responses.push([name, result, callId]);
  }
  return { methodResponses: responses };
}

/** Start the server. `state` records what the extension sent, for the test to inspect. */
export async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'fa-e2e-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=fastmail-assist-test',
    '-addext', 'subjectAltName=DNS:app.fastmail.com,DNS:api.fastmail.com,DNS:api.anthropic.com',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
  ], { stdio: 'ignore' });

  const state = { jmapRequests: [], claudeRequests: [], drafts: [] };

  const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString();
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', '*');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();
      const json = (data) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));

      if (host === 'app.fastmail.com') {
        if (req.url === '/squire.js') {
          return res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(resolve(root, 'node_modules/squire-rte/dist/squire.js')));
        }
        return res.writeHead(200, { 'content-type': 'text/html' }).end(appPage());
      }

      if (host === 'api.fastmail.com') {
        if (req.headers.authorization !== 'Bearer test-token') return res.writeHead(401).end();
        if (req.url.startsWith('/jmap/session')) {
          return json({ apiUrl: 'https://api.fastmail.com/jmap/api/', primaryAccounts: { 'urn:ietf:params:jmap:mail': 'u1' } });
        }
        const body = JSON.parse(raw);
        state.jmapRequests.push(body);
        return json(jmap(body, state));
      }

      if (host === 'api.anthropic.com') {
        const body = JSON.parse(raw);
        state.claudeRequests.push({ headers: req.headers, body });
        if (!body.stream) return json({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' });
        const wantsSubject = /Subject: <subject>/.test(body.system);
        const revised = body.messages.length > 1;
        const text = (wantsSubject ? 'Subject: Dinner on Friday\n\n' : '') + (revised ? 'Hi Dana,\n\nYes to the 12th, and we will bring dessert.\n\nSam & Alex' : REPLY);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        send({ type: 'message_start', message: { id: 'msg_test', role: 'assistant', content: [] } });
        send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        for (const piece of text.match(/[\s\S]{1,9}/g)) {
          send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
          await new Promise((r) => setTimeout(r, 25));
        }
        send({ type: 'content_block_stop', index: 0 });
        send({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
        send({ type: 'message_stop' });
        return res.end();
      }
      res.writeHead(404).end();
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, state, close: () => server.close() };
}

// Content script for app.fastmail.com: the part of Fastmail Assist that lives
// inside the Fastmail page.
//
//   launcher   a floating button, always available (the fallback entry point);
//              with a conversation open it splits into "Reply with AI | New"
//   toolbar    "Reply with AI" next to Fastmail's own Reply button (optional,
//              and the only piece that looks at Fastmail's markup)
//   composer   a card where you say what the email should say, see the draft,
//              and insert it into the open draft or save it to Drafts
//
// What it does not do: read mail from the page, or hold keys. It sends the
// page URL and your instruction to the background worker, which reads the
// conversation over JMAP and calls the model. The draft comes back as text.
//
// Keep this file free of imports. Content scripts are classic scripts. Shared
// message types are ambient (src/protocol.d.ts).

(() => {
  const HOST_ID = 'fastmail-assist-root';
  if (window.top !== window || document.getElementById(HOST_ID)) return;

  // The same pattern as src/lib/fastmailUrl.ts; a unit test keeps them identical.
  const CONVERSATION_ID = /\/mail\/[^?#\s]+?\/(?:(T[0-9a-f]{8,}|A[A-Za-z0-9_-]{8,})(?:\.(M[0-9a-f]{8,}|S[A-Za-z0-9_-]{8,}))?|(M[0-9a-f]{8,}|S[A-Za-z0-9_-]{8,}))(?=[\s?#]|$)/;
  /** Sections of Fastmail where a mail assistant has no business. */
  const NOT_MAIL = /^\/(calendar|contacts|settings|files|notes|login|signup)(\/|$)/;
  /** Names of Fastmail's Reply button, for the optional toolbar button. */
  const REPLY_LABEL = /^(reply|antworten|répondre|responder|rispondi|beantwoorden|svara|svar)$/i;

  const inMail = () => !NOT_MAIL.test(location.pathname);
  const conversationOpen = () => CONVERSATION_ID.test(`${location.pathname} ${location.hash}`);

  // --- DOM helpers ------------------------------------------------------------

  type Child = Node | string | null | false | undefined;

  function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, string | boolean | number> = {},
    ...children: Child[]
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = String(value);
      else if (typeof value === 'boolean') {
        if (value) el.setAttribute(key, '');
      } else el.setAttribute(key, String(value));
    }
    for (const child of children) if (child) el.append(child);
    return el;
  }

  const ICONS: Record<string, string[]> = {
    // The reply arrow with a sparkle: the extension's mark (see scripts/make-icons.mjs).
    logo: [
      'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
      'M19 1.6Q19 5 22.4 5Q19 5 19 8.4Q19 5 15.6 5Q19 5 19 1.6Z',
    ],
    close: ['M6 6l12 12M18 6L6 18'],
    panel: ['M4 5h16v14H4zM14 5v14'],
    gear: [
      'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
    ],
  };

  function icon(name: keyof typeof ICONS, size = 16): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    const filled = name === 'logo';
    svg.setAttribute('fill', filled ? 'currentColor' : 'none');
    if (!filled) {
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
    }
    for (const d of ICONS[name] ?? []) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // --- Styles -------------------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    .fa {
      --surface: #ffffff; --raised: #f6f7f9; --text: #151c28; --muted: #5c6676;
      --line: rgba(17, 24, 39, 0.12); --accent: #2456e6; --accent-2: #7a4bf0;
      --on-accent: #ffffff; --danger: #b42318; --ok: #1a7f4b;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.08), 0 12px 32px rgba(16, 24, 40, 0.18);
      color: var(--text); color-scheme: light;
      font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .fa[data-theme='dark'] {
      --surface: #1c212c; --raised: #262c39; --text: #edf0f5; --muted: #9aa4b5;
      --line: rgba(255, 255, 255, 0.14); --accent: #7ea2ff; --accent-2: #b093ff;
      --on-accent: #0d1424; --danger: #ff9c94; --ok: #74d6a0;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px rgba(0, 0, 0, 0.55);
      color-scheme: dark;
    }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    button:disabled { cursor: default; opacity: 0.5; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: inline-flex; align-items: stretch; height: 34px; border-radius: 17px; overflow: hidden;
      color: #fff; background: linear-gradient(135deg, #2456e6, #7a4bf0);
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.2), 0 6px 18px rgba(52, 76, 220, 0.35);
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .launcher:hover { transform: translateY(-1px); box-shadow: 0 2px 4px rgba(16, 24, 40, 0.2), 0 10px 24px rgba(52, 76, 220, 0.45); }
    .launcher button { display: inline-flex; align-items: center; gap: 6px; padding: 0 13px 0 11px; border: 0; background: none; color: inherit; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
    .launcher button:hover { background: rgba(255, 255, 255, 0.12); }
    .launcher .new { padding: 0 12px; border-left: 1px solid rgba(255, 255, 255, 0.3); }
    .launcher :focus-visible { outline-offset: -3px; outline-color: #fff; }

    .card {
      position: fixed; z-index: 2147483001; right: 20px; bottom: 20px;
      width: 392px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      display: flex; flex-direction: column;
      background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow); overflow: hidden;
      animation: rise 0.14s ease-out;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } .launcher { transition: none; } }

    header { display: flex; align-items: center; gap: 10px; padding: 11px 8px 11px 14px; cursor: grab; user-select: none; border-bottom: 1px solid var(--line); }
    header:active { cursor: grabbing; }
    .mark { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; color: #fff; background: linear-gradient(135deg, #2456e6, #7a4bf0); }
    .titles { flex: 1; min-width: 0; }
    .title { font-weight: 650; font-size: 13.5px; }
    .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { color: var(--muted); font-size: 12px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .ghost { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 7px; background: none; color: var(--muted); }
    .ghost:hover { background: var(--raised); color: var(--text); }

    .body { padding: 12px 14px 14px; overflow: hidden auto; display: flex; flex-direction: column; gap: 10px; }
    textarea, input[type='text'], select {
      width: 100%; border: 1px solid var(--line); border-radius: 9px; background: var(--surface);
      padding: 8px 10px; outline: none;
    }
    textarea { resize: vertical; display: block; line-height: 1.5; }
    textarea:focus, input[type='text']:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
    ::placeholder { color: var(--muted); opacity: 0.85; }
    .instruction { min-height: 62px; }
    .draft { min-height: 120px; max-height: 46vh; background: var(--raised); }
    .actions .btn { flex: 1; }
    .row { display: flex; align-items: center; gap: 8px; }
    .grow { flex: 1; min-width: 0; }
    .from { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; min-width: 0; }
    .from select { padding: 5px 8px; font-size: 12.5px; color: var(--text); text-overflow: ellipsis; }
    .btn { flex: none; height: 32px; padding: 0 13px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; white-space: nowrap; }
    .btn:hover:not(:disabled) { background: var(--raised); }
    .btn.primary { border-color: transparent; color: var(--on-accent); background: var(--accent); }
    .btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, #000); }
    .btn kbd { font: inherit; font-weight: 500; opacity: 0.7; margin-left: 5px; }
    .check { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
    .check input { accent-color: var(--accent); margin: 0; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field > span { font-size: 12px; font-weight: 600; color: var(--muted); }
    .suggest { margin: 2px 0 0; padding: 4px; list-style: none; background: var(--surface); border: 1px solid var(--line); border-radius: 9px; box-shadow: var(--shadow); max-height: 190px; overflow: auto; }
    .suggest li { display: flex; gap: 8px; align-items: baseline; min-width: 0; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .suggest li[aria-selected='true'], .suggest li:hover { background: var(--raised); }
    .suggest .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .suggest .addr { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hint { color: var(--muted); font-size: 12px; margin: 0; }
    .status { margin: 0; font-size: 12.5px; }
    .status[data-kind='error'] { color: var(--danger); }
    .status[data-kind='ok'] { color: var(--ok); }
    .status[data-kind='info'] { color: var(--muted); }
    a, .link { color: var(--accent); background: none; border: 0; padding: 0; font-weight: 600; text-decoration: none; cursor: pointer; }
    a:hover, .link:hover { text-decoration: underline; }
    .banner { background: var(--raised); border-radius: 9px; padding: 8px 10px; font-size: 12.5px; color: var(--muted); }
    .dots::after { content: ''; animation: dots 1.2s steps(4, end) infinite; }
    @keyframes dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }

    .toast {
      position: fixed; z-index: 2147483002; left: 50%; bottom: 28px; transform: translateX(-50%);
      background: #151c28; color: #fff; padding: 9px 14px; border-radius: 10px; font-weight: 500;
      box-shadow: var(--shadow);
    }
  `;

  // --- Elements -----------------------------------------------------------------

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Closed, so the page's own scripts cannot reach in. Opened only for tests.
  const root = host.attachShadow({ mode: __FA_OPEN_SHADOW__ ? 'open' : 'closed' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(h('style', {}, CSS));
  }

  const launcherLabel = h('span');
  const launcherMain = h('button', { class: 'main', type: 'button', title: 'Fastmail Assist (Alt+Shift+D)' }, icon('logo', 16), launcherLabel);
  const launcherNew = h('button', { class: 'new', type: 'button', title: 'Draft a new email instead of a reply', hidden: true }, 'New');
  const launcher = h('div', { class: 'launcher', role: 'group', 'aria-label': 'Fastmail Assist' }, launcherMain, launcherNew);

  const title = h('div', { class: 'title' });
  const sub = h('div', { class: 'sub' });
  const panelButton = h('button', { class: 'ghost', type: 'button', title: 'Open the side panel', 'aria-label': 'Open the side panel' }, icon('panel'));
  const settingsButton = h('button', { class: 'ghost', type: 'button', title: 'Settings', 'aria-label': 'Settings' }, icon('gear'));
  const closeButton = h('button', { class: 'ghost', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close' }, icon('close'));
  const header = h('header', {}, h('span', { class: 'mark' }, icon('logo', 15)), h('div', { class: 'titles' }, title, sub), panelButton, settingsButton, closeButton);

  const setup = h('div', { class: 'banner', hidden: true });
  const setupButton = h('button', { class: 'btn primary', type: 'button' }, 'Open settings');
  setup.append('Add your Fastmail token, Claude key and an identity to start. ', h('div', { class: 'row', style: 'margin-top:8px' }, setupButton));

  const switchBanner = h('div', { class: 'banner', hidden: true });
  const switchButton = h('button', { class: 'link', type: 'button' }, 'Switch to it');
  switchBanner.append('You opened another conversation. ', switchButton, ' (discards this draft)');

  const toInput = h('input', {
    type: 'text', 'aria-label': 'To', placeholder: 'Name or address; your contacts fill in as you type',
    autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
  });
  const suggest = h('ul', { class: 'suggest', role: 'listbox', 'aria-label': 'Matching people', hidden: true });
  const toRow = h('div', { class: 'field to', hidden: true }, h('span', {}, 'To'), toInput, suggest);
  const instruction = h('textarea', { class: 'instruction', rows: 2, 'aria-label': 'What should the email say?' });
  const identity = h('select', { 'aria-label': 'From' });
  const draftButton = h('button', { class: 'btn primary', type: 'button' });
  const compose = h('div', { class: 'row' }, h('label', { class: 'from grow' }, 'From', identity), draftButton);

  const subjectInput = h('input', { type: 'text', 'aria-label': 'Subject', spellcheck: 'true' });
  const subjectRow = h('div', { class: 'field', hidden: true }, h('span', {}, 'Subject'), subjectInput);
  const draft = h('textarea', { class: 'draft', 'aria-label': 'Draft (edit freely)', spellcheck: 'true' });
  const revision = h('input', { type: 'text', class: 'grow', placeholder: 'Change it: shorter, warmer, in German…', 'aria-label': 'Ask for a revision' });
  const reviseButton = h('button', { class: 'btn', type: 'button' }, 'Revise');
  const replyAll = h('input', { type: 'checkbox' });
  const replyAllLabel = h('label', { class: 'check' }, replyAll, 'Reply all');
  const copyButton = h('button', { class: 'link', type: 'button' }, 'Copy');
  const saveButton = h('button', { class: 'btn', type: 'button' }, 'Save to Drafts');
  const insertButton = h('button', { class: 'btn primary', type: 'button' }, 'Insert into draft');
  const hint = h('p', { class: 'hint', hidden: true });
  const result = h(
    'div',
    { hidden: true, style: 'display:flex;flex-direction:column;gap:10px' },
    subjectRow,
    draft,
    h('div', { class: 'row' }, revision, reviseButton),
    h('div', { class: 'row' }, replyAllLabel, h('span', { class: 'grow' }), copyButton),
    h('div', { class: 'row actions' }, saveButton, insertButton),
    hint,
  );

  const status = h('p', { class: 'status', role: 'status', hidden: true });
  const body = h('div', { class: 'body' }, setup, switchBanner, toRow, instruction, compose, result, status);
  const card = h('section', { class: 'card', role: 'dialog', 'aria-label': 'Fastmail Assist', hidden: true }, header, body);
  const toast = h('div', { class: 'toast', role: 'status', hidden: true });
  const wrap = h('div', { class: 'fa' }, launcher, card, toast);
  root.append(wrap);

  // --- State ----------------------------------------------------------------------

  interface Editor {
    el: HTMLElement;
    /** Caret in a rich-text editor. */
    range: Range | null;
    /** Caret in a plain-text editor. */
    start: number;
    end: number;
  }

  const state = {
    open: false,
    features: { configured: true, toolbarButton: true, canOpenPanel: false } as FA.Features,
    /** "new": the owner chose New on the launcher, so the open conversation is left alone. */
    mode: 'auto' as 'auto' | 'new',
    conversation: null as FA.Conversation | null,
    /** A conversation opened while a draft for another one is on screen. */
    other: null as FA.Conversation | null,
    loading: false,
    busy: null as null | 'draft' | 'save',
    hasDraft: false,
    identityChosen: false,
    /** Earlier conversations the background found with the recipient. */
    history: null as null | { count: number; with: string },
    /** Address-book matches for the entry being typed in To, and the highlighted one. */
    people: [] as FA.Person[],
    active: -1,
    /** True once the owner has changed the prefilled To of a reply. */
    toEdited: false,
    /** True once the extension has been reloaded under this page. */
    dead: false,
  };
  let editor: Editor | null = null;
  let seq = 0;
  let contextId = 0;
  let requestId = 0;
  let peopleId = 0;
  let historyId = 0;
  /** The To addresses the last history request was about. */
  let historyFor = '';
  /** Pages this tab showed recently, newest first. */
  const recentUrls: { url: string; at: number }[] = [{ url: location.href, at: Date.now() }];

  // --- Background connection ---------------------------------------------------

  let port: chrome.runtime.Port | null = null;

  function post(request: FA.Request): boolean {
    try {
      if (!port) {
        port = chrome.runtime.connect({ name: 'fa' });
        port.onMessage.addListener(onReply);
        port.onDisconnect.addListener(() => {
          port = null;
          if (state.busy || state.loading) {
            state.busy = null;
            state.loading = false;
            say('error', 'Lost the connection to the extension. Try again.');
            render();
          }
        });
      }
      port.postMessage(request);
      return true;
    } catch {
      port = null;
      state.dead = true;
      state.busy = null;
      state.loading = false;
      say('error', 'Fastmail Assist was updated. Reload this tab to keep using it.');
      render();
      return false;
    }
  }

  function oneShot(message: FA.OneShot): Promise<unknown> {
    try {
      return chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  }

  function onReply(reply: FA.Reply) {
    if (reply.type === 'context') {
      if (reply.id !== contextId) return;
      state.loading = false;
      state.features = reply.features;
      fillIdentities(reply.identities);
      const next = reply.conversation;
      const changed = next?.ref.threadId !== state.conversation?.ref.threadId;
      if (changed && state.hasDraft) {
        // Never throw away a draft because the page moved on; offer the switch.
        state.other = next;
      } else {
        if (changed) switchTo(next);
        else if (next && !state.toEdited && !toInput.value.trim()) toInput.value = next.to;
        state.other = null;
      }
      if (reply.error) say('error', reply.error);
      render();
      return;
    }
    if (reply.type === 'people') {
      if (reply.id === peopleId) showPeople(reply.people);
      return;
    }
    if (reply.type === 'history') {
      // Follows the context reply (a reply) or answers a history request (a new email).
      if (reply.id !== contextId && reply.id !== historyId) return;
      state.history = reply.count > 0 ? { count: reply.count, with: reply.with } : null;
      render();
      return;
    }
    if (reply.id !== requestId) return;
    if (reply.type === 'progress' || reply.type === 'done') {
      draft.value = reply.body;
      fitDraft();
      if (reply.subject) subjectInput.value = reply.subject;
      state.hasDraft = Boolean(reply.body) || state.hasDraft;
      if (reply.type === 'done') {
        state.busy = null;
        say(reply.truncated ? 'info' : null, 'The draft was cut off at the length limit.');
      } else {
        draft.scrollTop = draft.scrollHeight;
      }
    } else if (reply.type === 'saved') {
      state.busy = null;
      say('ok', state.conversation ? 'Saved to Drafts, threaded onto this conversation. ' : 'Saved to Drafts. ', { label: 'Open Drafts', href: reply.draftsUrl });
    } else if (reply.type === 'error') {
      state.busy = null;
      say('error', reply.message);
    }
    render();
  }

  // --- Rendering ----------------------------------------------------------------

  function say(kind: 'error' | 'ok' | 'info' | null, text = '', link?: { label: string; href: string }) {
    status.hidden = kind === null;
    status.replaceChildren();
    if (kind === null) return;
    status.dataset.kind = kind;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.append(text);
    if (link) status.append(h('a', { href: link.href }, link.label));
  }

  function fillIdentities(list: { email: string; name: string }[]) {
    const previous = identity.value;
    identity.replaceChildren(...list.map((item) => h('option', { value: item.email }, item.name ? `${item.name} <${item.email}>` : item.email)));
    if (list.some((item) => item.email === previous)) identity.value = previous;
  }

  /** Grow the draft box to show the whole draft, up to the limit set in the styles. */
  function fitDraft() {
    draft.style.height = 'auto';
    draft.style.height = `${draft.scrollHeight + 2}px`;
  }

  function resetDraft() {
    draft.value = '';
    revision.value = '';
    subjectInput.value = '';
    state.hasDraft = false;
    say(null);
  }

  /** Show another conversation, or none (a new email), discarding the draft. */
  function switchTo(next: FA.Conversation | null) {
    resetDraft();
    state.conversation = next;
    state.history = null;
    state.toEdited = false;
    if (next) state.mode = 'auto';
    showPeople([]);
    // A reply goes to the message's sender; a new email starts with To empty.
    toInput.value = next?.to ?? '';
    if (next) {
      if (next.suggestedIdentity && !state.identityChosen) identity.value = next.suggestedIdentity;
    } else {
      // A new email: the background is asked about the people in To instead.
      historyFor = '';
      askHistory();
    }
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const historyNote = () => (state.history ? `${plural(state.history.count, 'earlier conversation')} with ${state.history.with}` : '');

  function liveEditor(): Editor | null {
    if (editor && editor.el.isConnected && bigEnough(editor.el)) return editor;
    editor = null;
    return null;
  }

  function render() {
    const hasEditor = Boolean(liveEditor());
    const talk = state.conversation;
    const ready = state.features.configured && !state.dead;

    launcher.hidden = state.open || !inMail();
    // With a draft open the address may name the draft, not the conversation;
    // then the conversation the composer last found still counts.
    const replying = conversationOpen() || (hasEditor && Boolean(state.conversation));
    launcherLabel.textContent = replying ? 'Reply with AI' : hasEditor ? 'Write with AI' : 'Draft with AI';
    launcherNew.hidden = !replying;
    card.hidden = !state.open;
    if (!state.open) return;

    wrap.dataset.theme = pageIsDark() ? 'dark' : 'light';
    title.textContent = state.loading && !talk ? 'Fastmail Assist' : talk ? `Reply to ${talk.replyTo}` : 'New email';
    const background = historyNote();
    sub.textContent = state.loading && !talk
      ? 'Looking up the conversation…'
      : talk
        ? [`${talk.subject} · ${plural(talk.messageCount, 'message')}`, background].filter(Boolean).join(' · ')
        : background || (hasEditor ? 'Writes into your open draft' : 'Say who it is for and what it should say');
    panelButton.hidden = !state.features.canOpenPanel;

    setup.hidden = state.features.configured;
    switchBanner.hidden = !state.other;
    instruction.hidden = compose.hidden = !ready;
    toRow.hidden = !ready;
    toInput.placeholder = talk ? '' : 'Name or address; your contacts fill in as you type';
    instruction.placeholder = talk ? 'What should the reply say? e.g. Yes to the 12th, ask if they can host' : 'What is this email about? e.g. Invite them to dinner on Friday';

    const drafting = state.busy === 'draft';
    draftButton.replaceChildren(drafting ? 'Stop' : state.hasDraft ? 'Draft again' : 'Draft');
    if (!drafting) draftButton.append(h('kbd', {}, /Mac/i.test(navigator.platform) ? '⌘↵' : 'Ctrl↵'));
    draftButton.className = drafting ? 'btn' : state.hasDraft ? 'btn' : 'btn primary';
    draftButton.disabled = state.busy === 'save' || state.loading;

    result.hidden = !ready || (!state.hasDraft && !drafting);
    draft.readOnly = drafting;
    draft.placeholder = drafting ? 'Writing…' : '';
    subjectRow.hidden = Boolean(talk);
    subjectInput.readOnly = drafting;

    const idle = !state.busy && state.hasDraft;
    // A reply saves to its prefilled To; an edited or new-email To needs a valid address.
    const canSave = talk ? !state.toEdited || recipients().length > 0 : recipients().length > 0;
    reviseButton.disabled = !idle || !revision.value.trim();
    copyButton.disabled = !idle;
    insertButton.hidden = !hasEditor;
    insertButton.disabled = !idle;
    saveButton.hidden = !canSave;
    saveButton.disabled = !idle;
    saveButton.className = hasEditor ? 'btn' : 'btn primary';
    saveButton.textContent = state.busy === 'save' ? 'Saving…' : 'Save to Drafts';
    replyAllLabel.hidden = !talk;
    hint.hidden = hasEditor;
    hint.textContent = talk
      ? 'Or click Reply in Fastmail to insert it straight into your draft.'
      : canSave
        ? 'Save to Drafts writes it to Fastmail Drafts with the To and Subject above; or start a new message in Fastmail to insert it.'
        : 'Add a To address to save it to Drafts, start a new message in Fastmail to insert it there, or copy it.';
  }

  function pageIsDark(): boolean {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
    if (!match) return matchMedia('(prefers-color-scheme: dark)').matches;
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  }

  let toastTimer = 0;
  function showToast(text: string) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3200);
  }

  // --- Composer actions ---------------------------------------------------------

  function loadContext() {
    if (state.dead) return;
    contextId = ++seq;
    state.loading = true;
    // With a draft editor open the URL may no longer name the conversation, so
    // offer the pages this tab showed in the last few minutes as well.
    const urls = [location.href];
    if (liveEditor()) {
      for (const entry of recentUrls) {
        if (Date.now() - entry.at < 10 * 60_000 && !urls.includes(entry.url)) urls.push(entry.url);
      }
    }
    // After New on the launcher, no conversation is offered at all.
    post({ type: 'context', id: contextId, urls: state.mode === 'new' ? [] : urls });
    render();
  }

  function openComposer(mode: 'auto' | 'new' = 'auto') {
    if (!state.open) {
      state.open = true;
      card.style.cssText = '';
      // New, chosen deliberately: a reply draft from before is let go.
      if (mode === 'new' && state.conversation) switchTo(null);
      state.mode = mode;
      loadContext();
    }
    render();
    instruction.focus();
  }

  function closeComposer() {
    state.open = false;
    // A new email in progress stays one when the composer is reopened.
    if (!state.hasDraft) state.mode = 'auto';
    render();
  }

  function generate(change?: string) {
    if (state.busy === 'draft') {
      post({ type: 'cancel', id: requestId });
      state.busy = null;
      render();
      return;
    }
    if (state.busy || state.loading) return;
    const text = instruction.value.trim();
    if (!state.conversation && !text) {
      say('error', 'Say what the email should be about.');
      instruction.focus();
      return;
    }
    const current = state.conversation ? draft.value : `Subject: ${subjectInput.value.trim()}\n\n${draft.value}`;
    requestId = ++seq;
    state.busy = 'draft';
    say(null);
    if (!change) draft.value = '';
    post({
      type: 'generate',
      id: requestId,
      ref: state.conversation?.ref ?? null,
      ...(state.conversation ? {} : { to: toInput.value }),
      instruction: text,
      identityEmail: identity.value,
      ...(change ? { current, revision: change } : {}),
    });
    render();
  }

  function revise() {
    const change = revision.value.trim();
    if (!change || state.busy || !state.hasDraft) return;
    revision.value = '';
    generate(change);
  }

  function save() {
    if (state.busy || !draft.value.trim()) return;
    if ((!state.conversation || state.toEdited) && recipients().length === 0) {
      say('error', 'Add who the email is for in To first.');
      toInput.focus();
      return;
    }
    requestId = ++seq;
    state.busy = 'save';
    say(null);
    if (state.conversation) {
      post({
        type: 'save',
        id: requestId,
        ref: state.conversation.ref,
        identityEmail: identity.value,
        replyAll: replyAll.checked,
        body: draft.value,
        pageUrl: location.href,
        ...(state.toEdited ? { to: toInput.value } : {}),
      });
    } else {
      post({
        type: 'save-new',
        id: requestId,
        identityEmail: identity.value,
        to: toInput.value,
        subject: subjectInput.value.trim(),
        body: draft.value,
        pageUrl: location.href,
      });
    }
    render();
  }

  // --- The To field: who the new email is for, with help from the address book ------

  const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

  /** The valid addresses in the To field, with or without a name in front. */
  function recipients(): string[] {
    return toInput.value
      .split(/[,;\n]/)
      .map((entry) => (/<([^<>\s]+)>/.exec(entry)?.[1] ?? entry).trim())
      .filter((address) => ADDRESS.test(address));
  }

  /** The entry the caret is in: everything since the last comma. */
  function currentEntry(): { start: number; end: number; text: string } {
    const value = toInput.value;
    const caret = toInput.selectionStart ?? value.length;
    const start = Math.max(value.lastIndexOf(',', caret - 1), value.lastIndexOf(';', caret - 1)) + 1;
    return { start, end: caret, text: value.slice(start, caret).trim() };
  }

  let peopleTimer = 0;
  let historyTimer = 0;

  function onToChanged() {
    clearTimeout(peopleTimer);
    clearTimeout(historyTimer);
    if (state.conversation) state.toEdited = true;
    const entry = currentEntry();
    if (entry.text.length < 2) showPeople([]);
    else {
      peopleTimer = window.setTimeout(() => {
        peopleId = ++seq;
        post({ type: 'people', id: peopleId, query: entry.text });
      }, 160);
    }
    historyTimer = window.setTimeout(askHistory, 500);
    render();
  }

  /** Ask how much earlier mail there is with the people now in To, once per change. */
  function askHistory() {
    if (state.conversation) return;
    const key = recipients().join(',').toLowerCase();
    if (key === historyFor) return;
    historyFor = key;
    state.history = null;
    render();
    if (!key) return;
    historyId = ++seq;
    post({ type: 'history', id: historyId, to: toInput.value });
  }

  function showPeople(people: FA.Person[]) {
    state.people = people;
    state.active = people.length > 0 ? 0 : -1;
    suggest.replaceChildren(
      ...people.map((person, index) => {
        const item = h(
          'li',
          { role: 'option', 'aria-selected': String(index === state.active) },
          h('span', { class: 'name' }, person.name || person.email),
          person.name ? h('span', { class: 'addr' }, person.email) : null,
        );
        // mousedown, not click, so the To field keeps focus and its caret.
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          pickPerson(person);
        });
        return item;
      }),
    );
    suggest.hidden = people.length === 0 || root.activeElement !== toInput;
    toInput.setAttribute('aria-expanded', String(!suggest.hidden));
  }

  function highlight(step: number) {
    if (state.people.length === 0) return;
    state.active = (state.active + step + state.people.length) % state.people.length;
    suggest.querySelectorAll('li').forEach((item, index) => item.setAttribute('aria-selected', String(index === state.active)));
    suggest.children[state.active]?.scrollIntoView({ block: 'nearest' });
  }

  /** Put the chosen person in place of the entry being typed. */
  function pickPerson(person: FA.Person) {
    const entry = currentEntry();
    const value = toInput.value;
    const formatted = person.name ? `${person.name} <${person.email}>` : person.email;
    const before = value.slice(0, entry.start).trim();
    const after = value.slice(entry.end).replace(/^\s*[,;]?\s*/, '').trim();
    const head = `${before ? `${before} ` : ''}${formatted}`;
    toInput.value = after ? `${head}, ${after}` : head;
    toInput.setSelectionRange(head.length, head.length);
    clearTimeout(peopleTimer);
    clearTimeout(historyTimer);
    showPeople([]);
    askHistory();
    render();
  }

  async function copy() {
    const text = draft.value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      draft.select();
      document.execCommand('copy');
    }
    say('ok', 'Copied.');
  }

  async function insert() {
    const target = liveEditor();
    const text = draft.value.trim();
    if (!target || !text || state.busy) return;
    if (await insertIntoEditor(target, text)) {
      resetDraft();
      instruction.value = '';
      closeComposer();
      showToast('Inserted into your draft. Review and send it in Fastmail.');
    } else {
      say('error', 'Could not write into the draft editor. Use Copy or Save to Drafts instead.');
      render();
    }
  }

  // --- Draft editor: find it, remember the caret, write into it ------------------

  function editingHost(node: EventTarget | null): HTMLElement | null {
    if (!(node instanceof HTMLElement) || node === host) return null;
    if (node instanceof HTMLTextAreaElement) return node.readOnly || node.disabled ? null : node;
    if (!node.isContentEditable) return null;
    let el = node;
    while (el.parentElement?.isContentEditable) el = el.parentElement;
    return el;
  }

  /** Big enough to be a message body rather than a search box or address field. */
  function bigEnough(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width >= 280 && rect.height >= 56;
  }

  function rememberCaret() {
    if (!editor) return;
    const el = editor.el;
    if (el instanceof HTMLTextAreaElement) {
      if (document.activeElement === el) {
        editor.start = el.selectionStart;
        editor.end = el.selectionEnd;
      }
      return;
    }
    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      editor.range = selection.getRangeAt(0).cloneRange();
    }
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Put text at the caret of the open draft. Rich-text editors get a paste
   * event carrying plain text, which is how they expect outside text to
   * arrive; if the editor ignores it, the browser's own insertText is used.
   * Only the amount of text in the editor is looked at, to see that it worked.
   */
  async function insertIntoEditor(target: Editor, text: string): Promise<boolean> {
    const el = target.el;
    el.focus();

    if (el instanceof HTMLTextAreaElement) {
      const start = Math.min(target.start, el.value.length);
      el.setRangeText(text, start, start, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    }

    const selection = document.getSelection();
    let range = target.range;
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const size = () => (el.textContent ?? '').length;
    const before = size();
    const grew = async (waitMs: number) => {
      for (let waited = 0; waited <= waitMs; waited += 30) {
        if (size() > before) return true;
        await sleep(30);
      }
      return false;
    };

    try {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      const at = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const ignored = (at ?? el).dispatchEvent(paste);
      // An editor that takes the paste may insert a moment later.
      if (!ignored && (await grew(900))) return true;
      if (!ignored) return size() > before;
    } catch {
      // Fall through to insertText.
    }
    try {
      if (document.execCommand('insertText', false, text) && (await grew(300))) return true;
    } catch {
      // Nothing else to try.
    }
    return size() > before;
  }

  // --- Optional button next to Fastmail's own Reply ------------------------------

  const TOOLBAR_MARK = 'data-fastmail-assist';
  let toolbarButton: HTMLButtonElement | null = null;

  function findReplyButton(): HTMLElement | null {
    let found: HTMLElement | null = null;
    for (const el of document.querySelectorAll<HTMLElement>('button, [role="button"]')) {
      if (el.hasAttribute(TOOLBAR_MARK) || host.contains(el)) continue;
      const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
      if (!REPLY_LABEL.test(name)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) found = el; // the last one is the newest message's
    }
    return found;
  }

  function syncToolbarButton() {
    const wanted = state.features.toolbarButton && !state.dead && inMail() && conversationOpen();
    const anchor = wanted ? findReplyButton() : null;
    if (!anchor) {
      toolbarButton?.remove();
      toolbarButton = null;
      return;
    }
    if (toolbarButton?.isConnected && toolbarButton.previousElementSibling === anchor) return;
    toolbarButton?.remove();

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(TOOLBAR_MARK, 'reply');
    button.title = 'Draft a reply with Fastmail Assist';
    const look = getComputedStyle(anchor);
    Object.assign(button.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: look.height,
      margin: '0 0 0 6px',
      padding: '0 12px',
      border: '1px solid rgba(90, 100, 230, 0.45)',
      borderRadius: look.borderRadius === '0px' ? '6px' : look.borderRadius,
      background: 'linear-gradient(135deg, rgba(36, 86, 230, 0.10), rgba(122, 75, 240, 0.12))',
      color: 'inherit',
      font: look.font,
      fontWeight: '600',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      verticalAlign: look.verticalAlign,
    });
    const mark = icon('logo', 15);
    mark.style.color = '#5a55ea';
    button.append(mark, 'Reply with AI');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openComposer();
    });
    anchor.insertAdjacentElement('afterend', button);
    toolbarButton = button;
  }

  // --- Wiring ---------------------------------------------------------------------

  // While you type in the composer, Fastmail must not see the keys: its
  // single-letter shortcuts act on mail. Events from inside the shadow root
  // surface with the host as their target, so they are stopped here, at the
  // very top, before any page listener; that is also why the composer's own
  // shortcuts are handled in this spot. This runs at document_start so that
  // it is registered before Fastmail's listeners.
  const GUARDED = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend'];
  for (const type of GUARDED) {
    window.addEventListener(
      type,
      (event) => {
        if (event.target !== host) return;
        event.stopImmediatePropagation();
        if (type === 'keydown') onKeydown(event as KeyboardEvent);
        else if (type === 'input') {
          if (root.activeElement === toInput) onToChanged();
          else render();
        }
      },
      true,
    );
  }

  function onKeydown(event: KeyboardEvent) {
    const focused = root.activeElement;
    if (focused === toInput && !suggest.hidden) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        highlight(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const person = state.people[state.active];
        if (person) {
          event.preventDefault();
          pickPerson(person);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        showPeople([]);
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeComposer();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && focused === instruction) {
      event.preventDefault();
      if (state.busy !== 'draft') generate();
    } else if (event.key === 'Enter' && !event.isComposing && focused === revision) {
      event.preventDefault();
      revise();
    }
  }

  // mousedown is stopped so that a click keeps the caret in an open draft editor.
  launcher.addEventListener('mousedown', (event) => event.preventDefault());
  launcherMain.addEventListener('click', () => openComposer());
  launcherNew.addEventListener('click', () => openComposer('new'));
  closeButton.addEventListener('click', closeComposer);
  settingsButton.addEventListener('click', () => void oneShot({ type: 'fa:open-settings' }));
  setupButton.addEventListener('click', () => void oneShot({ type: 'fa:open-settings' }));
  panelButton.addEventListener('click', () => {
    void oneShot({ type: 'fa:open-panel' });
    closeComposer();
  });
  switchButton.addEventListener('click', () => {
    switchTo(state.other);
    state.other = null;
    render();
  });
  toInput.addEventListener('focus', () => showPeople(state.people));
  toInput.addEventListener('blur', () => {
    suggest.hidden = true;
    toInput.setAttribute('aria-expanded', 'false');
  });
  identity.addEventListener('change', () => (state.identityChosen = true));
  draftButton.addEventListener('click', () => generate());
  reviseButton.addEventListener('click', revise);
  copyButton.addEventListener('click', () => void copy());
  saveButton.addEventListener('click', save);
  insertButton.addEventListener('click', () => void insert());

  // Drag the card by its header.
  header.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('button')) return;
    const rect = card.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    header.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const left = Math.max(4, Math.min(innerWidth - rect.width - 4, e.clientX - dx));
      const top = Math.max(4, Math.min(innerHeight - 60, e.clientY - dy));
      Object.assign(card.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    };
    const stop = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', stop);
      header.removeEventListener('pointercancel', stop);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
  });

  document.addEventListener(
    'focusin',
    (event) => {
      const el = editingHost(event.target);
      if (!el || !inMail() || !bigEnough(el)) return;
      if (editor?.el !== el) editor = { el, range: null, start: 0, end: 0 };
      rememberCaret();
      render();
    },
    true,
  );
  document.addEventListener('selectionchange', rememberCaret);

  chrome.runtime.onMessage.addListener((message: FA.ToTab) => {
    if (message?.type === 'fa:toggle-composer') {
      if (state.open) closeComposer();
      else openComposer();
    } else if (message?.type === 'fa:features') {
      // Settings were saved, perhaps while this composer sat open asking for
      // them: take the new features and, if it is open, the new identities.
      state.features = message.features;
      if (state.open) loadContext();
      else render();
    }
  });

  // Coming back to this tab after a visit to the settings page: re-check,
  // in case the push above did not reach a tab that was in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || state.dead) return;
    if (state.open) loadContext();
    else void oneShot({ type: 'fa:hello' }).then((answer) => answer && ((state.features = answer as FA.Features), render()));
  });

  /** Fastmail is a single-page app: watch the address and the page for changes. */
  function tick() {
    if (location.href !== recentUrls[0]?.url) {
      recentUrls.unshift({ url: location.href, at: Date.now() });
      recentUrls.length = Math.min(recentUrls.length, 6);
      if (state.open) loadContext();
    }
    syncToolbarButton();
    render();
  }

  function start() {
    document.documentElement.append(host);
    render();
    void oneShot({ type: 'fa:hello' }).then((answer) => {
      if (answer) state.features = answer as FA.Features;
      tick();
    });
    setInterval(tick, 600);
    window.addEventListener('popstate', tick);
    window.addEventListener('hashchange', tick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

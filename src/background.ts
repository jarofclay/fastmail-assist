// Background worker (a service worker in Chrome, an event page in Firefox).
//
// It opens the side panel, keeps stored keys out of reach of content scripts,
// and does the mail and model work for the composer that the content script
// shows inside the Fastmail page. The content script sends a page URL and an
// instruction; keys and raw mail never leave this side.

import { draftEmail, describeConversation } from './lib/engine';
import { draftsUrl, hasConversation, isFastmailUrl, parseMailContext, type MailContext } from './lib/fastmailUrl';
import { displayName, JmapClient, JmapError } from './lib/jmap';
import { buildNewDraft, buildReplyDraft, parseAddressList } from './lib/reply';
import { isConfigured, loadSettings, onSettingsChanged } from './lib/settings';
import type { Address, Correspondence, Settings, Thread } from './lib/types';

/** Firefox has a sidebar instead of Chrome's side panel. */
declare const browser:
  | { sidebarAction?: { open(): Promise<void>; toggle(): Promise<void> } }
  | undefined;

const hasSidePanel = typeof chrome.sidePanel !== 'undefined';
const sidebar = typeof browser !== 'undefined' ? browser.sidebarAction : undefined;

const FASTMAIL_TABS = 'https://app.fastmail.com/*';

chrome.runtime.onInstalled.addListener(() => {
  if (hasSidePanel) void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // storage.local is readable from content scripts unless restricted. Firefox
  // has no such switch; there the content script simply never asks for it.
  void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
});

// --- Chrome: the side panel belongs to Fastmail tabs ---------------------------
//
// Chrome's side panel is window-wide by default: once open, it shows in every
// tab of the window, new tabs included. So the default panel is switched off
// and a tab-specific one is enabled on Fastmail tabs only. Without the "tabs"
// permission a tab's URL is readable only on Fastmail, so a navigation whose
// URL cannot be read means the tab is somewhere else.

const enablePanel = (tabId: number) => chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled: true }).catch(() => undefined);
const disablePanel = (tabId: number) => chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);

if (hasSidePanel) {
  // Runs each time the worker starts: side panel options do not outlive the browser session.
  void chrome.sidePanel.setOptions({ enabled: false });
  chrome.tabs.query({ url: FASTMAIL_TABS }).then(
    (tabs) => tabs.forEach((tab) => tab.id !== undefined && void enablePanel(tab.id)),
    () => undefined,
  );
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'loading' && change.url === undefined) return;
    void (isFastmailUrl(change.url ?? tab.url) ? enablePanel(tabId) : disablePanel(tabId));
  });
}

/** Bring a Fastmail tab to the front, or open one, for the panel to live in. */
async function focusFastmail(): Promise<void> {
  const [existing] = await chrome.tabs.query({ url: FASTMAIL_TABS });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://app.fastmail.com/' });
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (hasSidePanel) {
    // On a Fastmail tab Chrome itself toggles the panel (openPanelOnActionClick).
    if (!isFastmailUrl(tab.url)) void focusFastmail().catch(() => undefined);
  } else if (sidebar) {
    // Firefox: the toolbar button toggles the sidebar.
    void sidebar.toggle();
  }
});

function features(settings: Settings): FA.Features {
  return {
    configured: isConfigured(settings),
    toolbarButton: settings.inPage.toolbarButton,
    editorChip: settings.inPage.editorChip,
    canOpenPanel: hasSidePanel,
  };
}

// Saved settings reach every open Fastmail tab at once, so a composer that was
// left open asking for keys stops asking without a reload.
onSettingsChanged((settings) => {
  const message: FA.ToTab = { type: 'fa:features', features: features(settings) };
  chrome.tabs.query({ url: 'https://app.fastmail.com/*' }).then(
    (tabs) => tabs.forEach((tab) => tab.id !== undefined && chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)),
    () => undefined,
  );
});

const fromFastmailTab = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id && sender.tab?.id !== undefined && isFastmailUrl(sender.url ?? sender.tab.url);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!fromFastmailTab(sender)) return;
  const type = (message as FA.OneShot | null)?.type;
  if (type === 'fa:open-panel') {
    // Must run inside the click's user-gesture window, so nothing is awaited first.
    if (hasSidePanel) void chrome.sidePanel.open({ tabId: sender.tab!.id! });
  } else if (type === 'fa:open-settings') {
    void chrome.runtime.openOptionsPage();
  } else if (type === 'fa:hello') {
    void loadSettings().then((settings) => sendResponse(features(settings)));
    return true; // keep the channel open for the async answer
  }
  return;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (command === 'open-panel' && hasSidePanel) {
    if (isFastmailUrl(tab.url)) void chrome.sidePanel.open({ tabId: tab.id });
    else void focusFastmail().catch(() => undefined);
  } else if (command === 'quick-draft') {
    const message: FA.ToTab = { type: 'fa:toggle-composer' };
    chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
  }
});

// --- Composer requests from the content script ------------------------------

/** One client per token, so the JMAP session is fetched once, not per request. */
let cachedClient: { token: string; client: JmapClient } | null = null;
function clientFor(settings: Settings): JmapClient {
  if (cachedClient?.token !== settings.fastmailToken) cachedClient = { token: settings.fastmailToken, client: new JmapClient(settings.fastmailToken) };
  return cachedClient.client;
}

/** Conversations and histories loaded a moment ago, so drafting does not fetch them twice. */
const CACHE_TTL_MS = 2 * 60_000;
const threads = new Map<string, { thread: Thread; at: number }>();
const histories = new Map<string, { history: Correspondence; at: number }>();

const keyOf = (ref: MailContext) => ref.threadId ?? ref.emailId ?? '';

function remember<T>(cache: Map<string, { at: number } & T>, key: string, value: T) {
  cache.set(key, { ...value, at: Date.now() });
  if (cache.size > 20) cache.delete(cache.keys().next().value as string);
}

async function getThread(client: JmapClient, ref: MailContext): Promise<Thread> {
  const cached = threads.get(keyOf(ref));
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.thread;
  const thread = await client.getThread(ref);
  remember(threads, keyOf(ref), { thread });
  return thread;
}

/** Earlier conversations with these people, apart from the thread being answered. */
async function getHistory(client: JmapClient, settings: Settings, people: Address[], excludeThreadId?: string): Promise<Correspondence> {
  const empty: Correspondence = { with: people, emails: [] };
  if (!settings.history || people.length === 0) return empty;
  const key = `${people.map((a) => a.email.toLowerCase()).sort().join(',')}|${excludeThreadId ?? ''}`;
  const cached = histories.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.history;
  const history: Correspondence = { with: people, emails: await client.correspondence(people.map((a) => a.email), { excludeThreadId }) };
  remember(histories, key, { history });
  return history;
}

/** Who to describe the history as being with, for the UI. */
const historyWith = (people: Address[]) => people.map((a) => displayName(a)).join(', ');

const cleanRef = (ref: FA.Ref): MailContext => {
  const id = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(value) ? value : undefined);
  return { threadId: id(ref.threadId), emailId: id(ref.emailId) };
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'fa' || !port.sender || !fromFastmailTab(port.sender)) {
    port.disconnect();
    return;
  }
  const running = new Map<number, AbortController>();
  let open = true;
  const send = (reply: FA.Reply) => {
    if (open) port.postMessage(reply);
  };

  port.onDisconnect.addListener(() => {
    open = false;
    for (const controller of running.values()) controller.abort();
  });

  port.onMessage.addListener((request: FA.Request) => {
    if (request.type === 'cancel') {
      running.get(request.id)?.abort();
      return;
    }
    const controller = new AbortController();
    running.set(request.id, controller);
    handle(request, send, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) send({ type: 'error', id: request.id, message: (error as Error).message });
      })
      .finally(() => running.delete(request.id));
  });
});

async function handle(
  request: Exclude<FA.Request, { type: 'cancel' }>,
  send: (reply: FA.Reply) => void,
  signal: AbortSignal,
): Promise<void> {
  const settings = await loadSettings();
  const client = clientFor(settings);
  const { id } = request;
  const ownEmails = settings.identities.map((i) => i.email);

  if (request.type === 'context') {
    const reply: FA.Reply = {
      type: 'context',
      id,
      features: features(settings),
      identities: settings.identities.map(({ email, name }) => ({ email, name })),
      conversation: null,
    };
    let found: { thread: Thread; with: Address[] } | null = null;
    if (isConfigured(settings)) {
      // The first URL that names a real conversation wins. Later ones are
      // pages the tab showed just before, used when a draft is being written.
      for (const url of request.urls.slice(0, 5)) {
        const ref = parseMailContext(url);
        if (!hasConversation(ref)) continue;
        try {
          const thread = await getThread(client, ref);
          const described = describeConversation(thread, settings);
          reply.conversation = { ref: { threadId: thread.id }, ...described.info };
          found = { thread, with: described.with };
          break;
        } catch (error) {
          // A draft of a brand-new email has an id but no conversation yet;
          // that is not an error. A bad token or no connection is.
          if (!(error instanceof JmapError) || error.fatal) {
            reply.error = (error as Error).message;
            break;
          }
        }
      }
    }
    send(reply);
    // The composer is usable now; the earlier-mail count follows when it is in.
    if (found && settings.history && !signal.aborted) {
      try {
        const history = await getHistory(client, settings, found.with, found.thread.id);
        send({ type: 'history', id, count: history.emails.length, with: historyWith(history.with) });
      } catch {
        // Background only; the reply works without it.
      }
    }
    return;
  }

  if (request.type === 'people') {
    const people = await client.searchPeople(String(request.query ?? ''), { exclude: ownEmails });
    send({ type: 'people', id, people });
    return;
  }

  if (request.type === 'history') {
    const people = parseAddressList(String(request.to ?? ''));
    const history = await getHistory(client, settings, people);
    send({ type: 'history', id, count: history.emails.length, with: historyWith(history.with) });
    return;
  }

  if (!isConfigured(settings)) throw new Error('Fastmail Assist is not set up yet. Open its settings first.');
  const identity = settings.identities.find((i) => i.email === request.identityEmail) ?? settings.identities[0];
  if (!identity) throw new Error('Add an identity in the settings first.');

  if (request.type === 'generate') {
    const thread = request.ref ? await getThread(client, cleanRef(request.ref)) : undefined;
    const to = String(request.to ?? '');
    const history = thread
      ? await getHistory(client, settings, describeConversation(thread, settings).with, thread.id)
      : await getHistory(client, settings, parseAddressList(to));
    let last = 0;
    const result = await draftEmail({
      settings,
      identity,
      mode: thread ? 'reply' : 'compose',
      thread,
      recipients: to,
      history,
      instruction: String(request.instruction ?? ''),
      current: request.current,
      revision: request.revision,
      signal,
      onProgress: (draft) => {
        // The page only needs to repaint a few times a second.
        if (Date.now() - last < 80) return;
        last = Date.now();
        send({ type: 'progress', id, body: draft.body, subject: draft.subject });
      },
    });
    send({ type: 'done', id, ...result });
    return;
  }

  if (request.type === 'save') {
    const thread = await getThread(client, cleanRef(request.ref));
    const { target } = describeConversation(thread, settings);
    await client.createDraft(
      buildReplyDraft({
        target,
        identity,
        ownEmails,
        replyAll: Boolean(request.replyAll),
        body: String(request.body ?? ''),
      }),
    );
    send({ type: 'saved', id, draftsUrl: draftsUrl(request.pageUrl) });
    return;
  }

  if (request.type === 'save-new') {
    const to = parseAddressList(String(request.to ?? ''));
    if (to.length === 0) throw new Error('Add at least one valid address in To.');
    await client.createDraft(buildNewDraft(identity, to, String(request.subject ?? '').trim(), String(request.body ?? '')));
    send({ type: 'saved', id, draftsUrl: draftsUrl(request.pageUrl) });
  }
}

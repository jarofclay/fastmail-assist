// Background worker (a service worker in Chrome, an event page in Firefox).
//
// It opens the side panel, keeps stored keys out of reach of content scripts,
// and does the mail and model work for the composer that the content script
// shows inside the Fastmail page. The content script sends a page URL and an
// instruction; keys and raw mail never leave this side.

import { draftEmail, describeConversation } from './lib/engine';
import { draftsUrl, hasConversation, isFastmailUrl, parseMailContext, type MailContext } from './lib/fastmailUrl';
import { JmapClient, JmapError } from './lib/jmap';
import { buildReplyDraft } from './lib/reply';
import { isConfigured, loadSettings } from './lib/settings';
import type { Settings, Thread } from './lib/types';

/** Firefox has a sidebar instead of Chrome's side panel. */
declare const browser:
  | { sidebarAction?: { open(): Promise<void>; toggle(): Promise<void> } }
  | undefined;

const hasSidePanel = typeof chrome.sidePanel !== 'undefined';
const sidebar = typeof browser !== 'undefined' ? browser.sidebarAction : undefined;

chrome.runtime.onInstalled.addListener(() => {
  if (hasSidePanel) void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // storage.local is readable from content scripts unless restricted. Firefox
  // has no such switch; there the content script simply never asks for it.
  void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
});

// Firefox: the toolbar button toggles the sidebar. Chrome handles this itself.
if (!hasSidePanel && sidebar) {
  chrome.action.onClicked.addListener(() => void sidebar.toggle());
}

function features(settings: Settings): FA.Features {
  return {
    configured: isConfigured(settings),
    toolbarButton: settings.inPage.toolbarButton,
    editorChip: settings.inPage.editorChip,
    canOpenPanel: hasSidePanel,
  };
}

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
    void chrome.sidePanel.open({ tabId: tab.id });
  } else if (command === 'quick-draft') {
    const message: FA.ToTab = { type: 'fa:toggle-composer' };
    chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
  }
});

// --- Composer requests from the content script ------------------------------

/** Conversations loaded a moment ago, so drafting does not fetch them twice. */
const threads = new Map<string, { thread: Thread; at: number }>();
const THREAD_TTL_MS = 2 * 60_000;

const keyOf = (ref: MailContext) => ref.threadId ?? ref.emailId ?? '';

async function getThread(client: JmapClient, ref: MailContext): Promise<Thread> {
  const cached = threads.get(keyOf(ref));
  if (cached && Date.now() - cached.at < THREAD_TTL_MS) return cached.thread;
  const thread = await client.getThread(ref);
  threads.set(keyOf(ref), { thread, at: Date.now() });
  if (threads.size > 20) threads.delete(threads.keys().next().value as string);
  return thread;
}

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
  const client = new JmapClient(settings.fastmailToken);
  const { id } = request;

  if (request.type === 'context') {
    const reply: FA.Reply = {
      type: 'context',
      id,
      features: features(settings),
      identities: settings.identities.map(({ email, name }) => ({ email, name })),
      conversation: null,
    };
    if (isConfigured(settings)) {
      // The first URL that names a real conversation wins. Later ones are
      // pages the tab showed just before, used when a draft is being written.
      for (const url of request.urls.slice(0, 5)) {
        const ref = parseMailContext(url);
        if (!hasConversation(ref)) continue;
        try {
          const thread = await getThread(client, ref);
          reply.conversation = { ref: { threadId: thread.id }, ...describeConversation(thread, settings).info };
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
    return;
  }

  if (!isConfigured(settings)) throw new Error('Fastmail Assist is not set up yet. Open its settings first.');
  const identity = settings.identities.find((i) => i.email === request.identityEmail) ?? settings.identities[0];
  if (!identity) throw new Error('Add an identity in the settings first.');

  if (request.type === 'generate') {
    const thread = request.ref ? await getThread(client, cleanRef(request.ref)) : undefined;
    let last = 0;
    const result = await draftEmail({
      settings,
      identity,
      mode: thread ? 'reply' : 'compose',
      thread,
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
        ownEmails: settings.identities.map((i) => i.email),
        replyAll: Boolean(request.replyAll),
        body: String(request.body ?? ''),
      }),
    );
    send({ type: 'saved', id, draftsUrl: draftsUrl(request.pageUrl) });
  }
}

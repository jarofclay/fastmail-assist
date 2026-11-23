<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { describeConversation, draftEmail } from '../lib/engine';
import { draftsUrl, hasConversation, parseMailContext, sameConversation, type MailContext } from '../lib/fastmailUrl';
import { JmapClient } from '../lib/jmap';
import type { Mode } from '../lib/prompt';
import { buildNewDraft, buildReplyDraft, parseAddressList } from '../lib/reply';
import { emptySettings, isConfigured, loadSettings, onSettingsChanged } from '../lib/settings';
import type { Correspondence, Person, Settings, Thread, ThreadSummary } from '../lib/types';

const settings = ref<Settings>(emptySettings());
const ready = ref(false);
const mode = ref<Mode>('reply');

const context = ref<MailContext>({});
/** A conversation opened in Fastmail while an unsaved draft is on screen. */
const pending = ref<MailContext | null>(null);
const thread = ref<Thread | null>(null);
const recent = ref<ThreadSummary[]>([]);
const loading = ref(false);

const identityEmail = ref('');
const replyAll = ref(false);
const recipients = ref('');
const toField = ref<HTMLInputElement | null>(null);
/** Address-book matches for the entry being typed in To, and the highlighted one. */
const people = ref<Person[]>([]);
const active = ref(-1);
const listOpen = ref(false);
/** Earlier conversations with the recipient, given to the model as background. */
const history = ref<Correspondence | null>(null);
const subject = ref('');
const instruction = ref('');
const draft = ref('');
const refinement = ref('');

const busy = ref<null | 'draft' | 'save'>(null);
const error = ref('');
const notice = ref('');
const saved = ref(false);
let abort: AbortController | null = null;

const configured = computed(() => isConfigured(settings.value));
const ownEmails = computed(() => settings.value.identities.map((i) => i.email));
const identity = computed(
  () => settings.value.identities.find((i) => i.email === identityEmail.value) ?? settings.value.identities[0],
);
const conversation = computed(() => (thread.value ? describeConversation(thread.value, settings.value) : null));
const client = computed(() => new JmapClient(settings.value.fastmailToken));
const showForm = computed(() => mode.value === 'compose' || Boolean(conversation.value));
const shortcut = /Mac/i.test(navigator.platform) ? '⌘↵' : 'Ctrl↵';
const historyNote = computed(() => {
  const found = history.value;
  if (!found || found.emails.length === 0) return '';
  const n = found.emails.length;
  return `${n} earlier conversation${n === 1 ? '' : 's'} with ${found.with.map((a) => a.name?.trim() || a.email).join(', ')}`;
});

function resetDraft() {
  abort?.abort();
  draft.value = '';
  refinement.value = '';
  notice.value = '';
  error.value = '';
  saved.value = false;
}

async function openConversation(next: MailContext, keepDraft = false) {
  context.value = next;
  pending.value = null;
  if (!keepDraft) {
    resetDraft();
    instruction.value = '';
  }
  await loadThread();
}

function setMode(next: Mode) {
  if (mode.value === next) return;
  mode.value = next;
  resetDraft();
  history.value = null;
  if (next === 'compose') void loadComposeHistory();
  else void loadReplyHistory();
}

// --- Earlier conversations with the recipient ---------------------------------

async function loadReplyHistory() {
  history.value = null;
  const found = conversation.value;
  if (!settings.value.history || !found || !thread.value) return;
  const threadId = thread.value.id;
  try {
    const emails = await client.value.correspondence(found.with.map((a) => a.email), { excludeThreadId: threadId });
    if (thread.value?.id === threadId) history.value = { with: found.with, emails };
  } catch {
    // Background only; the reply works without it.
  }
}

let historyFor = '';
async function loadComposeHistory() {
  const to = parseAddressList(recipients.value);
  const key = to.map((a) => a.email.toLowerCase()).join(',');
  if (key === historyFor && history.value) return;
  historyFor = key;
  history.value = null;
  if (!settings.value.history || to.length === 0) return;
  try {
    const emails = await client.value.correspondence(to.map((a) => a.email));
    if (historyFor === key) history.value = { with: to, emails };
  } catch {
    // Background only.
  }
}

// --- The To field, with help from the address book --------------------------

/** The entry the caret is in: everything since the last comma. */
function currentEntry(): { start: number; end: number; text: string } {
  const value = recipients.value;
  const caret = toField.value?.selectionStart ?? value.length;
  const start = Math.max(value.lastIndexOf(',', caret - 1), value.lastIndexOf(';', caret - 1)) + 1;
  return { start, end: caret, text: value.slice(start, caret).trim() };
}

let peopleTimer = 0;
let historyTimer = 0;
let peopleSeq = 0;
function onRecipientsInput() {
  clearTimeout(peopleTimer);
  clearTimeout(historyTimer);
  const entry = currentEntry();
  if (entry.text.length < 2) {
    people.value = [];
    listOpen.value = false;
  } else {
    peopleTimer = window.setTimeout(async () => {
      const seq = ++peopleSeq;
      try {
        const found = await client.value.searchPeople(entry.text, { exclude: ownEmails.value });
        if (seq !== peopleSeq) return;
        people.value = found;
        active.value = found.length > 0 ? 0 : -1;
        listOpen.value = found.length > 0;
      } catch {
        people.value = [];
      }
    }, 160);
  }
  historyTimer = window.setTimeout(() => void loadComposeHistory(), 500);
}

function pickPerson(person: Person) {
  const entry = currentEntry();
  const value = recipients.value;
  const formatted = person.name ? `${person.name} <${person.email}>` : person.email;
  const before = value.slice(0, entry.start).trim();
  const after = value.slice(entry.end).replace(/^\s*[,;]?\s*/, '').trim();
  const head = `${before ? `${before} ` : ''}${formatted}`;
  recipients.value = after ? `${head}, ${after}` : head;
  people.value = [];
  listOpen.value = false;
  clearTimeout(peopleTimer);
  clearTimeout(historyTimer);
  void loadComposeHistory();
  requestAnimationFrame(() => {
    toField.value?.focus();
    toField.value?.setSelectionRange(head.length, head.length);
  });
}

function onRecipientsKeydown(event: KeyboardEvent) {
  if (!listOpen.value || people.value.length === 0) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const n = people.value.length;
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + n) % n;
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    const person = people.value[active.value];
    if (person) {
      event.preventDefault();
      pickPerson(person);
    }
  } else if (event.key === 'Escape') {
    event.preventDefault();
    listOpen.value = false;
  }
}

/** Follow the conversation open in Fastmail, without discarding work in progress. */
async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = parseMailContext(tab?.url);
  if (!hasConversation(next)) return;
  if (sameConversation(next, context.value)) {
    pending.value = null;
    return;
  }
  if (draft.value.trim()) pending.value = next;
  else await openConversation(next);
}

async function loadThread() {
  if (!configured.value) return;
  loading.value = true;
  error.value = '';
  try {
    if (hasConversation(context.value)) {
      thread.value = await client.value.getThread(context.value);
      const suggested = conversation.value?.info.suggestedIdentity;
      if (suggested) identityEmail.value = suggested;
      if (mode.value === 'reply') void loadReplyHistory();
    } else {
      thread.value = null;
      recent.value = await client.value.recentThreads();
    }
  } catch (e) {
    thread.value = null;
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function generate(revision?: string) {
  if (busy.value === 'draft') {
    abort?.abort();
    return;
  }
  const who = identity.value;
  if (!who || busy.value) return;
  if (mode.value === 'reply' && !thread.value) return;
  if (mode.value === 'compose' && !instruction.value.trim()) {
    error.value = 'Say what the email should be about.';
    return;
  }
  const current = mode.value === 'compose' ? `Subject: ${subject.value}\n\n${draft.value}` : draft.value;
  const controller = new AbortController();
  abort = controller;
  busy.value = 'draft';
  error.value = '';
  notice.value = '';
  saved.value = false;
  if (!revision) draft.value = '';
  try {
    const result = await draftEmail({
      settings: settings.value,
      identity: who,
      mode: mode.value,
      thread: thread.value ?? undefined,
      recipients: recipients.value,
      history: history.value ?? undefined,
      instruction: instruction.value,
      ...(revision ? { current, revision } : {}),
      signal: controller.signal,
      onProgress: (partial) => {
        draft.value = partial.body;
        if (partial.subject) subject.value = partial.subject;
      },
    });
    draft.value = result.body;
    if (result.subject) subject.value = result.subject;
    if (result.truncated) notice.value = 'The draft was cut off at the length limit.';
  } catch (e) {
    if (!controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    if (abort === controller) {
      abort = null;
      busy.value = null;
    }
  }
}

function refine() {
  const change = refinement.value.trim();
  if (!change || busy.value || !draft.value.trim()) return;
  refinement.value = '';
  void generate(change);
}

async function saveDraft() {
  const who = identity.value;
  if (!who || !draft.value.trim() || busy.value) return;
  busy.value = 'save';
  error.value = '';
  try {
    if (mode.value === 'reply') {
      if (!conversation.value) return;
      await client.value.createDraft(
        buildReplyDraft({
          target: conversation.value.target,
          identity: who,
          ownEmails: ownEmails.value,
          replyAll: replyAll.value,
          body: draft.value,
        }),
      );
      notice.value = 'Saved to Drafts, threaded onto this conversation.';
    } else {
      const to = parseAddressList(recipients.value);
      await client.value.createDraft(buildNewDraft(who, to, subject.value.trim(), draft.value));
      notice.value = 'Saved to Drafts.';
    }
    saved.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

async function copyDraft() {
  await navigator.clipboard.writeText(draft.value);
  notice.value = 'Copied.';
}

/** Show the Drafts folder in the Fastmail tab itself rather than opening another one. */
async function openDrafts() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { url: draftsUrl(tab.url) });
}

function openSettings() {
  void chrome.runtime.openOptionsPage();
}

function when(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- Keep work in progress when the panel is closed and reopened -------------
// storage.session lives in memory for the browser session and is not readable
// from content scripts.

const STASH = 'panel';
const STASH_MAX_AGE_MS = 12 * 60 * 60_000;

interface Stash {
  at: number;
  mode: Mode;
  context: MailContext;
  identityEmail: string;
  replyAll: boolean;
  recipients: string;
  subject: string;
  instruction: string;
  draft: string;
}

async function restore(): Promise<boolean> {
  const stored = (await chrome.storage.session?.get(STASH))?.[STASH] as Stash | undefined;
  if (!stored || Date.now() - stored.at > STASH_MAX_AGE_MS) return false;
  if (!stored.draft.trim() && !stored.instruction.trim()) return false;
  mode.value = stored.mode;
  context.value = stored.context;
  replyAll.value = stored.replyAll;
  recipients.value = stored.recipients;
  subject.value = stored.subject;
  instruction.value = stored.instruction;
  draft.value = stored.draft;
  await loadThread();
  if (settings.value.identities.some((i) => i.email === stored.identityEmail)) identityEmail.value = stored.identityEmail;
  return true;
}

let stashTimer = 0;
watch([mode, context, identityEmail, replyAll, recipients, subject, instruction, draft], () => {
  if (!ready.value) return;
  clearTimeout(stashTimer);
  stashTimer = window.setTimeout(() => {
    const stash: Stash = {
      at: Date.now(),
      mode: mode.value,
      context: { ...context.value },
      identityEmail: identityEmail.value,
      replyAll: replyAll.value,
      recipients: recipients.value,
      subject: subject.value,
      instruction: instruction.value,
      draft: draft.value,
    };
    void chrome.storage.session?.set({ [STASH]: stash });
  }, 300);
});

onMounted(async () => {
  settings.value = await loadSettings();
  identityEmail.value = settings.value.identities[0]?.email ?? '';
  const restored = await restore().catch(() => false);
  ready.value = true;
  onSettingsChanged((next) => {
    settings.value = next;
    void loadThread();
  });
  chrome.tabs.onActivated.addListener(() => void readActiveTab());
  chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (change.url && tab.active) void readActiveTab();
  });
  await readActiveTab();
  // Nothing restored and no conversation open in the tab: show recent ones.
  if (!restored && !hasConversation(context.value)) await loadThread();
  if (restored && mode.value === 'compose') void loadComposeHistory();
});
</script>

<template>
  <main v-if="ready" class="panel">
    <header>
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          <path d="M19 1.6Q19 5 22.4 5Q19 5 19 8.4Q19 5 15.6 5Q19 5 19 1.6Z" />
        </svg>
      </span>
      <h1 class="grow">Fastmail Assist</h1>
      <div v-if="configured" class="segmented" role="group" aria-label="Mode">
        <button :aria-pressed="mode === 'reply'" @click="setMode('reply')">Reply</button>
        <button :aria-pressed="mode === 'compose'" @click="setMode('compose')">New email</button>
      </div>
      <button class="ghost" title="Settings" aria-label="Settings" @click="openSettings">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
          <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" />
        </svg>
      </button>
    </header>

    <div v-if="!configured" class="card soft stack">
      <p>Add your Fastmail API token, Claude API key and at least one identity to start.</p>
      <div><button class="btn primary" @click="openSettings">Open settings</button></div>
    </div>

    <template v-else>
      <div v-if="pending && mode === 'reply'" class="card soft">
        You opened another conversation.
        <button class="link" @click="openConversation(pending)">Switch to it</button>
        <span class="muted"> (discards this draft)</span>
      </div>

      <template v-if="mode === 'reply'">
        <p v-if="loading" class="muted dots">Loading</p>

        <div v-else-if="thread && conversation" class="card soft">
          <strong class="truncate">{{ conversation.info.subject }}</strong>
          <div class="muted">
            Replying to {{ conversation.info.replyTo }} · {{ conversation.info.messageCount }}
            message{{ conversation.info.messageCount === 1 ? '' : 's' }}<template v-if="historyNote"> · {{ historyNote }}</template>
          </div>
          <button class="link" style="font-size: 12.5px" @click="openConversation({})">Choose another conversation</button>
        </div>

        <template v-else>
          <p class="muted">Open a conversation in Fastmail, or pick a recent one.</p>
          <ul v-if="recent.length" class="threads">
            <li v-for="item in recent" :key="item.threadId">
              <button @click="openConversation({ threadId: item.threadId, emailId: item.emailId })">
                <span class="top">
                  <span class="who truncate">{{ item.from }}</span>
                  <span class="when muted">{{ when(item.receivedAt) }}</span>
                </span>
                <span class="truncate">{{ item.subject }}</span>
                <span class="muted truncate">{{ item.preview }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="!error" class="empty">Your inbox has no conversations.</p>
        </template>
      </template>

      <div v-if="mode === 'compose'">
        <label for="recipients">To</label>
        <input
          id="recipients"
          ref="toField"
          v-model="recipients"
          type="text"
          placeholder="Name or address; your contacts fill in as you type"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="listOpen"
          aria-controls="people"
          @input="onRecipientsInput"
          @keydown="onRecipientsKeydown"
          @focus="listOpen = people.length > 0"
          @blur="listOpen = false"
        />
        <ul v-if="listOpen" id="people" class="suggest" role="listbox" aria-label="Matching people">
          <li
            v-for="(person, index) in people"
            :key="person.email"
            role="option"
            :aria-selected="index === active"
            @mousedown.prevent="pickPerson(person)"
          >
            <span class="name">{{ person.name || person.email }}</span>
            <span v-if="person.name" class="addr">{{ person.email }}</span>
          </li>
        </ul>
        <p v-if="historyNote" class="muted" style="margin-top: 6px">{{ historyNote }}</p>
      </div>

      <template v-if="showForm">
        <div>
          <label for="instruction">{{ mode === 'reply' ? 'What should the reply say?' : 'What is this email about?' }}</label>
          <textarea
            id="instruction"
            v-model="instruction"
            :placeholder="mode === 'reply' ? 'e.g. Yes to the 12th, ask if they can host' : 'e.g. Invite them to dinner on Friday, mention parking'"
            @keydown.meta.enter.prevent="busy !== 'draft' && generate()"
            @keydown.ctrl.enter.prevent="busy !== 'draft' && generate()"
          ></textarea>
        </div>

        <div class="row">
          <div class="grow">
            <label for="identity">From</label>
            <select id="identity" v-model="identityEmail">
              <option v-for="item in settings.identities" :key="item.email" :value="item.email">
                {{ item.name }} &lt;{{ item.email }}&gt;
              </option>
            </select>
          </div>
          <button
            :class="['btn', { primary: busy !== 'draft' && !draft }]"
            style="align-self: flex-end"
            :disabled="busy === 'save' || loading"
            @click="generate()"
          >
            <template v-if="busy === 'draft'">Stop</template>
            <template v-else>{{ draft ? 'Draft again' : 'Draft' }} <kbd>{{ shortcut }}</kbd></template>
          </button>
        </div>

        <template v-if="draft || busy === 'draft'">
          <div v-if="mode === 'compose'">
            <label for="subject">Subject</label>
            <input id="subject" v-model="subject" type="text" />
          </div>

          <div>
            <label for="draft">Draft <span style="font-weight: 400">(edit freely)</span></label>
            <textarea
              id="draft"
              v-model="draft"
              class="draft"
              :readonly="busy === 'draft'"
              :placeholder="busy === 'draft' ? 'Writing…' : ''"
            ></textarea>
          </div>

          <div class="row">
            <input
              v-model="refinement"
              class="grow"
              type="text"
              placeholder="Change it: shorter, warmer, in German…"
              aria-label="Ask for a revision"
              @keydown.enter="refine"
            />
            <button class="btn" :disabled="Boolean(busy) || !refinement.trim() || !draft.trim()" @click="refine">Revise</button>
          </div>

          <div class="row">
            <label v-if="mode === 'reply'" class="check"><input v-model="replyAll" type="checkbox" /> Reply all</label>
            <span class="grow"></span>
            <button class="btn" :disabled="Boolean(busy) || !draft.trim()" @click="copyDraft">Copy</button>
            <button class="btn primary" :disabled="Boolean(busy) || !draft.trim()" @click="saveDraft">
              {{ busy === 'save' ? 'Saving…' : 'Save to Drafts' }}
            </button>
          </div>
        </template>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="ok" role="status">
        {{ notice }}
        <button v-if="saved" class="link" @click="openDrafts">Open Drafts</button>
      </p>
    </template>
  </main>
</template>

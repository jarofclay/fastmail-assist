<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { createMessage, type ChatMessage } from '../lib/claude';
import { parseMailContext, type MailContext } from '../lib/fastmailUrl';
import { displayName, JmapClient } from '../lib/jmap';
import { composeRequest, parseComposeOutput, replyRequest, systemPrompt, type Mode } from '../lib/prompt';
import { buildNewDraft, buildReplyDraft, parseAddressList, pickIdentity, pickReplyTarget } from '../lib/reply';
import { emptySettings, isConfigured, loadSettings, onSettingsChanged } from '../lib/settings';
import type { Settings, Thread, ThreadSummary } from '../lib/types';

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
const subject = ref('');
const instruction = ref('');
const draft = ref('');
const refinement = ref('');
const history = ref<ChatMessage[]>([]);

const busy = ref(false);
const error = ref('');
const notice = ref('');

const configured = computed(() => isConfigured(settings.value));
const ownEmails = computed(() => settings.value.identities.map((i) => i.email));
const identity = computed(
  () => settings.value.identities.find((i) => i.email === identityEmail.value) ?? settings.value.identities[0],
);
const target = computed(() => (thread.value ? pickReplyTarget(thread.value, ownEmails.value) : null));
const client = computed(() => new JmapClient(settings.value.fastmailToken));

function resetDraft() {
  draft.value = '';
  refinement.value = '';
  history.value = [];
  notice.value = '';
  error.value = '';
}

function sameConversation(a: MailContext, b: MailContext): boolean {
  if (a.threadId && b.threadId) return a.threadId === b.threadId;
  return Boolean(a.emailId) && a.emailId === b.emailId;
}

/** Follow the conversation open in Fastmail, without discarding work in progress. */
async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const next = parseMailContext(tab?.url);
  if (!next.threadId && !next.emailId) return;
  if (sameConversation(next, context.value)) {
    pending.value = null;
    return;
  }
  if (draft.value.trim()) pending.value = next;
  else context.value = next;
}

function switchToPending() {
  if (pending.value) context.value = pending.value;
}

async function loadThread(where: MailContext) {
  if (!configured.value) return;
  loading.value = true;
  error.value = '';
  try {
    if (where.threadId || where.emailId) {
      thread.value = await client.value.getThread(where);
      const suggested = target.value ? pickIdentity(target.value, settings.value.identities) : undefined;
      if (suggested) identityEmail.value = suggested.email;
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

async function generate() {
  const who = identity.value;
  if (!who) return;
  let request: string;
  if (mode.value === 'reply') {
    if (!thread.value || !target.value) return;
    request = replyRequest(thread.value, target.value, ownEmails.value, instruction.value);
  } else {
    if (!instruction.value.trim()) {
      error.value = 'Say what the email should be about.';
      return;
    }
    request = composeRequest(recipients.value, instruction.value);
  }
  history.value = [{ role: 'user', content: request }];
  await runModel(who.email);
}

async function refine() {
  const who = identity.value;
  if (!who || !refinement.value.trim() || history.value.length === 0) return;
  // Carry manual edits forward: the model revises what is on screen.
  const current = mode.value === 'compose' ? `Subject: ${subject.value}\n\n${draft.value}` : draft.value;
  const turns = history.value.filter((m) => m.role === 'user');
  history.value = [
    { role: 'user', content: turns[0]?.content ?? '' },
    { role: 'assistant', content: current },
    { role: 'user', content: `Revise the draft: ${refinement.value.trim()}` },
  ];
  refinement.value = '';
  await runModel(who.email);
}

async function runModel(identityAtStart: string) {
  const who = settings.value.identities.find((i) => i.email === identityAtStart);
  if (!who) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const output = await createMessage({
      apiKey: settings.value.anthropicKey,
      model: settings.value.model,
      system: systemPrompt(who, mode.value),
      messages: history.value,
    });
    if (mode.value === 'compose') {
      const parsed = parseComposeOutput(output);
      if (parsed.subject) subject.value = parsed.subject;
      draft.value = parsed.body;
    } else {
      draft.value = output;
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function saveDraft() {
  const who = identity.value;
  if (!who || !draft.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    if (mode.value === 'reply') {
      if (!target.value) return;
      await client.value.createDraft(
        buildReplyDraft({
          target: target.value,
          identity: who,
          ownEmails: ownEmails.value,
          replyAll: replyAll.value,
          body: draft.value,
        }),
      );
      notice.value = 'Saved to Drafts. It appears in this conversation in Fastmail, ready to review and send.';
    } else {
      const to = parseAddressList(recipients.value);
      await client.value.createDraft(buildNewDraft(who, to, subject.value.trim(), draft.value));
      notice.value = 'Saved to Drafts in Fastmail, ready to review and send.';
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function openSettings() {
  void chrome.runtime.openOptionsPage();
}

function chooseThread(summary: ThreadSummary) {
  context.value = { threadId: summary.threadId, emailId: summary.emailId };
}

function clearThread() {
  context.value = {};
}

watch(context, (next) => {
  pending.value = null;
  resetDraft();
  instruction.value = '';
  void loadThread(next);
});

watch(mode, () => {
  resetDraft();
});

onMounted(async () => {
  settings.value = await loadSettings();
  identityEmail.value = settings.value.identities[0]?.email ?? '';
  ready.value = true;
  onSettingsChanged((next) => {
    settings.value = next;
    void loadThread(context.value);
  });
  chrome.tabs.onActivated.addListener(() => void readActiveTab());
  chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (change.url && tab.active) void readActiveTab();
  });
  const before = context.value;
  await readActiveTab();
  // If the tab had a conversation open, the watcher above loads it.
  if (context.value === before) await loadThread(before);
});
</script>

<template>
  <main v-if="ready">
    <div v-if="!configured" class="card">
      <p>Add your Fastmail API token, Claude API key and at least one identity to start.</p>
      <button class="primary" @click="openSettings">Open settings</button>
    </div>

    <template v-else>
      <div class="tabs" role="group" aria-label="Mode">
        <button :aria-pressed="mode === 'reply'" @click="mode = 'reply'">Reply</button>
        <button :aria-pressed="mode === 'compose'" @click="mode = 'compose'">New email</button>
        <span class="grow"></span>
        <button class="link" @click="openSettings">Settings</button>
      </div>

      <div v-if="pending && mode === 'reply'" class="card">
        A different conversation is open in Fastmail.
        <button class="link" @click="switchToPending">Switch to it</button>
        <span class="muted"> (discards this draft)</span>
      </div>

      <template v-if="mode === 'reply'">
        <p v-if="loading" class="muted">Loading conversation…</p>

        <div v-else-if="thread && target" class="card">
          <div class="truncate"><strong>{{ thread.emails[0]?.subject || '(no subject)' }}</strong></div>
          <div class="muted">
            {{ thread.emails.length }} message{{ thread.emails.length === 1 ? '' : 's' }} · replying to
            {{ displayName(target.from?.[0]) }}
          </div>
          <button class="link" @click="clearThread">Choose another conversation</button>
        </div>

        <template v-else>
          <p class="muted">Open a conversation in Fastmail, or pick a recent one:</p>
          <ul class="threads">
            <li v-for="item in recent" :key="item.threadId">
              <button @click="chooseThread(item)">
                <strong class="truncate">{{ item.subject }}</strong>
                <span class="muted truncate">{{ item.from }} · {{ item.preview }}</span>
              </button>
            </li>
          </ul>
        </template>
      </template>

      <template v-if="mode === 'compose'">
        <label for="recipients">To</label>
        <input id="recipients" v-model="recipients" type="text" placeholder="name@example.org, …" />
      </template>

      <template v-if="mode === 'compose' || (thread && target)">
        <label for="identity">From</label>
        <select id="identity" v-model="identityEmail">
          <option v-for="item in settings.identities" :key="item.email" :value="item.email">
            {{ item.name }} &lt;{{ item.email }}&gt;
          </option>
        </select>

        <label for="instruction">{{ mode === 'reply' ? 'What should the reply say?' : 'What is this email about?' }}</label>
        <textarea
          id="instruction"
          v-model="instruction"
          :placeholder="mode === 'reply' ? 'e.g. Yes to the 12th, ask if they can host' : 'e.g. Invite them to dinner on Friday, mention parking'"
          @keydown.meta.enter="generate"
          @keydown.ctrl.enter="generate"
        ></textarea>

        <div class="row">
          <label v-if="mode === 'reply'" class="row" style="margin: 0; font-weight: 400">
            <input v-model="replyAll" type="checkbox" /> Reply all
          </label>
          <span class="grow"></span>
          <button class="primary" :disabled="busy" @click="generate">
            {{ busy && !draft ? 'Drafting…' : draft ? 'Draft again' : 'Draft' }}
          </button>
        </div>

        <template v-if="draft">
          <template v-if="mode === 'compose'">
            <label for="subject">Subject</label>
            <input id="subject" v-model="subject" type="text" />
          </template>

          <label for="draft">Draft (edit freely)</label>
          <textarea id="draft" v-model="draft" class="draft"></textarea>

          <div class="row" style="margin-top: 8px">
            <input
              v-model="refinement"
              class="grow"
              type="text"
              placeholder="Change it: shorter, warmer, in German…"
              aria-label="Ask for a revision"
              @keydown.enter="refine"
            />
            <button :disabled="busy || !refinement.trim()" @click="refine">Revise</button>
          </div>

          <div class="row end" style="margin-top: 12px">
            <button class="primary" :disabled="busy" @click="saveDraft">Save to Fastmail Drafts</button>
          </div>
        </template>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="ok" role="status">{{ notice }}</p>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { testKey } from '../lib/claude';
import { JmapClient } from '../lib/jmap';
import { DEFAULT_MODEL, SUGGESTED_MODELS, emptySettings, isConfigured, loadSettings, saveSettings } from '../lib/settings';
import type { Settings } from '../lib/types';

const ORIGINS = ['https://app.fastmail.com/*', 'https://api.fastmail.com/*', 'https://api.anthropic.com/*'];

interface Check {
  state: 'idle' | 'busy' | 'ok' | 'failed';
  text: string;
}

const settings = ref<Settings>(emptySettings());
const savedJson = ref('');
const showToken = ref(false);
const showKey = ref(false);
const fastmail = ref<Check>({ state: 'idle', text: '' });
const claude = ref<Check>({ state: 'idle', text: '' });
const saveNote = ref('');
const saveError = ref('');
/** Firefox lets people decline site access at install; without it nothing works. */
const hasAccess = ref(true);

const dirty = computed(() => JSON.stringify(settings.value) !== savedJson.value);
/** What is still missing for the extension to work, judged on what is saved. */
const missing = computed(() => {
  if (!savedJson.value) return '';
  const saved = JSON.parse(savedJson.value) as Settings;
  if (isConfigured(saved)) return '';
  const parts = [
    !saved.fastmailToken && 'a Fastmail token',
    !saved.anthropicKey && 'a Claude key',
    saved.identities.length === 0 && 'at least one identity',
  ].filter(Boolean) as string[];
  return `Not ready yet: still needs ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}.`;
});
const identityProblem = computed(() => {
  const filled = settings.value.identities.filter((i) => i.email.trim());
  if (filled.some((i) => !/^[^\s@]+@[^\s@]+$/.test(i.email.trim()))) return 'One of the identities has an invalid email address.';
  if (filled.some((i) => !i.name.trim())) return 'Give every identity a name; it is used as the From name on drafts.';
  return '';
});

onMounted(async () => {
  settings.value = await loadSettings();
  savedJson.value = JSON.stringify(settings.value);
  hasAccess.value = await chrome.permissions.contains({ origins: ORIGINS }).catch(() => true);
});

async function grantAccess() {
  hasAccess.value = await chrome.permissions.request({ origins: ORIGINS }).catch(() => false);
}

function addIdentity() {
  settings.value.identities.push({ email: '', name: '', voice: '' });
}

function removeIdentity(index: number) {
  settings.value.identities.splice(index, 1);
}

async function save() {
  if (identityProblem.value) return;
  const cleaned: Settings = {
    ...settings.value,
    fastmailToken: settings.value.fastmailToken.trim(),
    anthropicKey: settings.value.anthropicKey.trim(),
    model: settings.value.model.trim() || DEFAULT_MODEL,
    identities: settings.value.identities
      .map((i) => ({ email: i.email.trim(), name: i.name.trim(), voice: i.voice.trim() }))
      .filter((i) => i.email),
  };
  saveError.value = '';
  try {
    await saveSettings(cleaned);
  } catch (e) {
    saveError.value = `Could not save: ${(e as Error).message}`;
    return;
  }
  settings.value = cleaned;
  savedJson.value = JSON.stringify(cleaned);
  saveNote.value = 'Saved.';
  setTimeout(() => (saveNote.value = ''), 2500);
}

async function run(check: typeof fastmail, action: () => Promise<string>) {
  check.value = { state: 'busy', text: 'Checking…' };
  try {
    check.value = { state: 'ok', text: await action() };
  } catch (e) {
    check.value = { state: 'failed', text: (e as Error).message };
  }
}

const testFastmail = () =>
  run(fastmail, async () => {
    const threads = await new JmapClient(settings.value.fastmailToken.trim()).recentThreads(1);
    return `Connected. ${threads.length ? 'The inbox is readable.' : 'The inbox is empty.'}`;
  });

const testClaude = () =>
  run(claude, async () => {
    const model = settings.value.model.trim() || DEFAULT_MODEL;
    await testKey(settings.value.anthropicKey.trim(), model);
    return `Connected. ${model} answered.`;
  });
</script>

<template>
  <main class="settings">
    <header>
      <span class="mark" style="width: 36px; height: 36px; border-radius: 11px" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M10 2.5l1.7 4.9a2 2 0 0 0 1.2 1.2l4.9 1.7-4.9 1.7a2 2 0 0 0-1.2 1.2L10 18.1l-1.7-4.9a2 2 0 0 0-1.2-1.2L2.2 10.3l4.9-1.7a2 2 0 0 0 1.2-1.2z" />
          <path d="M18.5 14.5l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
        </svg>
      </span>
      <div>
        <h1>Fastmail Assist</h1>
        <p class="muted">Keys stay in this browser profile and go only to Fastmail and to the Claude API.</p>
      </div>
    </header>

    <section v-if="!hasAccess" class="card soft">
      <h2>Site access needed</h2>
      <p class="muted">The extension needs access to Fastmail and the Claude API to read a conversation and write a draft.</p>
      <div><button class="btn primary" @click="grantAccess">Grant access</button></div>
    </section>

    <section class="card">
      <h2>Fastmail</h2>
      <div class="field">
        <label for="token">API token</label>
        <div class="secret">
          <input id="token" v-model="settings.fastmailToken" :type="showToken ? 'text' : 'password'" autocomplete="off" spellcheck="false" />
          <button class="btn" :aria-pressed="showToken" @click="showToken = !showToken">{{ showToken ? 'Hide' : 'Show' }}</button>
        </div>
      </div>
      <p class="muted">
        Create one in Fastmail under Settings → Privacy &amp; Security → Manage API tokens. Give it mail access and leave
        out sending (email submission), so this extension can save drafts but can never send.
      </p>
      <div class="row wrap">
        <button class="btn" :disabled="!settings.fastmailToken.trim() || fastmail.state === 'busy'" @click="testFastmail">Test connection</button>
        <span :class="fastmail.state === 'failed' ? 'error' : fastmail.state === 'ok' ? 'ok' : 'muted'" role="status">{{ fastmail.text }}</span>
      </div>
    </section>

    <section class="card">
      <h2>Claude</h2>
      <div class="field">
        <label for="key">API key</label>
        <div class="secret">
          <input id="key" v-model="settings.anthropicKey" :type="showKey ? 'text' : 'password'" autocomplete="off" spellcheck="false" />
          <button class="btn" :aria-pressed="showKey" @click="showKey = !showKey">{{ showKey ? 'Hide' : 'Show' }}</button>
        </div>
      </div>
      <div class="field">
        <label for="model">Model</label>
        <input id="model" v-model="settings.model" type="text" list="models" :placeholder="DEFAULT_MODEL" spellcheck="false" />
        <datalist id="models"><option v-for="id in SUGGESTED_MODELS" :key="id" :value="id" /></datalist>
      </div>
      <div class="row wrap">
        <button class="btn" :disabled="!settings.anthropicKey.trim() || claude.state === 'busy'" @click="testClaude">Test connection</button>
        <span :class="claude.state === 'failed' ? 'error' : claude.state === 'ok' ? 'ok' : 'muted'" role="status">{{ claude.text }}</span>
      </div>
    </section>

    <section class="card">
      <h2>Identities</h2>
      <p class="muted">
        The addresses you write from, and how each one sounds. The voice notes go into every draft request.
        <strong>At least one identity is required</strong>: without one the extension is not set up, even with both keys in place.
      </p>
      <div v-for="(item, index) in settings.identities" :key="index" class="card soft identity">
        <div class="row wrap">
          <div class="grow field">
            <label :for="`name-${index}`">Name</label>
            <input :id="`name-${index}`" v-model="item.name" type="text" />
          </div>
          <div class="grow field">
            <label :for="`email-${index}`">Email</label>
            <input :id="`email-${index}`" v-model="item.email" type="text" spellcheck="false" />
          </div>
        </div>
        <div class="field">
          <label :for="`voice-${index}`">Voice</label>
          <textarea
            :id="`voice-${index}`"
            v-model="item.voice"
            placeholder="e.g. Warm and brief. First names. Signs off with both our names."
          ></textarea>
        </div>
        <div class="row end"><button class="link" @click="removeIdentity(index)">Remove</button></div>
      </div>
      <div><button class="btn" @click="addIdentity">Add identity</button></div>
      <p v-if="identityProblem" class="error" role="alert">{{ identityProblem }}</p>
    </section>

    <section class="card">
      <h2>Inside Fastmail</h2>
      <p class="muted">The floating button is always there. These two extras can be turned off.</p>
      <label class="check">
        <input v-model="settings.inPage.editorChip" type="checkbox" />
        Show the ✦ button in the corner of an open draft, to write into it
      </label>
      <label class="check">
        <input v-model="settings.inPage.toolbarButton" type="checkbox" />
        Show “Reply with AI” next to Fastmail’s Reply button
      </label>
      <p class="muted">Shortcuts: Alt+Shift+D opens the composer in the page, Alt+Shift+R the side panel.</p>
    </section>

    <div class="savebar">
      <span v-if="saveError" class="error" role="alert">{{ saveError }}</span>
      <span v-else-if="saveNote" class="ok" role="status">{{ saveNote }}</span>
      <span v-else-if="dirty" class="muted">Unsaved changes</span>
      <span v-else-if="missing" class="muted" role="status">{{ missing }}</span>
      <span v-else class="ok" role="status">Ready. Fastmail Assist is set up.</span>
      <button class="btn primary" :disabled="!dirty || Boolean(identityProblem)" @click="save">Save settings</button>
    </div>
  </main>
</template>

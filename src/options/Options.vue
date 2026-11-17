<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { JmapClient } from '../lib/jmap';
import { DEFAULT_MODEL, emptySettings, loadSettings, saveSettings } from '../lib/settings';
import type { Settings } from '../lib/types';

const settings = ref<Settings>(emptySettings());
const status = ref('');
const failed = ref(false);

onMounted(async () => {
  settings.value = await loadSettings();
});

function addIdentity() {
  settings.value.identities.push({ email: '', name: '', voice: '' });
}

function removeIdentity(index: number) {
  settings.value.identities.splice(index, 1);
}

async function save() {
  const cleaned: Settings = {
    fastmailToken: settings.value.fastmailToken.trim(),
    anthropicKey: settings.value.anthropicKey.trim(),
    model: settings.value.model.trim() || DEFAULT_MODEL,
    identities: settings.value.identities
      .map((i) => ({ email: i.email.trim(), name: i.name.trim(), voice: i.voice.trim() }))
      .filter((i) => i.email),
  };
  await saveSettings(cleaned);
  settings.value = cleaned;
  failed.value = false;
  status.value = 'Saved.';
}

async function testFastmail() {
  failed.value = false;
  status.value = 'Checking Fastmail…';
  try {
    const threads = await new JmapClient(settings.value.fastmailToken.trim()).recentThreads(1);
    status.value = `Fastmail connection works (${threads.length ? 'inbox readable' : 'inbox is empty'}).`;
  } catch (e) {
    failed.value = true;
    status.value = (e as Error).message;
  }
}
</script>

<template>
  <main>
    <h1>Fastmail Assist settings</h1>
    <p class="muted">Keys are stored in this browser profile only and are sent only to Fastmail and to the Claude API.</p>

    <h2>Fastmail</h2>
    <label for="token">API token</label>
    <input id="token" v-model="settings.fastmailToken" type="password" autocomplete="off" />
    <p class="muted">
      Create one in Fastmail under Settings → Privacy &amp; Security → Manage API tokens. Give it mail access and
      leave out sending (email submission), so this extension can save drafts but cannot send.
    </p>
    <button @click="testFastmail">Test connection</button>

    <h2>Claude</h2>
    <label for="key">API key</label>
    <input id="key" v-model="settings.anthropicKey" type="password" autocomplete="off" />
    <label for="model">Model</label>
    <input id="model" v-model="settings.model" type="text" :placeholder="DEFAULT_MODEL" />

    <h2>Identities</h2>
    <p class="muted">The addresses you write from, and how each one sounds. The voice notes go into every draft request.</p>
    <div v-for="(item, index) in settings.identities" :key="index" class="card">
      <div class="row">
        <div class="grow">
          <label :for="`name-${index}`">Name</label>
          <input :id="`name-${index}`" v-model="item.name" type="text" />
        </div>
        <div class="grow">
          <label :for="`email-${index}`">Email</label>
          <input :id="`email-${index}`" v-model="item.email" type="text" />
        </div>
      </div>
      <label :for="`voice-${index}`">Voice</label>
      <textarea
        :id="`voice-${index}`"
        v-model="item.voice"
        placeholder="e.g. Warm and brief. First names. Signs off 'Joe & Kelly'."
      ></textarea>
      <div class="row end"><button class="link" @click="removeIdentity(index)">Remove</button></div>
    </div>
    <button @click="addIdentity">Add identity</button>

    <div class="row" style="margin-top: 20px">
      <button class="primary" @click="save">Save settings</button>
      <span :class="failed ? 'error' : 'ok'" role="status">{{ status }}</span>
    </div>
  </main>
</template>

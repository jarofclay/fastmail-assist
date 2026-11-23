import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { manifest } from '../scripts/manifest.mjs';
import { scanText } from '../scripts/scan-secrets.mjs';
import { streamMessage } from '../src/lib/claude';
import { buildChat, draftEmail } from '../src/lib/engine';
import { draftsUrl, parseMailContext } from '../src/lib/fastmailUrl';
import { saveSettings, withDefaults } from '../src/lib/settings';
import type { Identity, Settings, Thread } from '../src/lib/types';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const us: Identity = { email: 'us@example.org', name: 'Sam & Alex', voice: 'Warm and brief.' };
const settings: Settings = withDefaults({ fastmailToken: 't', anthropicKey: 'k', identities: [us] });
const thread: Thread = {
  id: 'T1',
  emails: [
    {
      id: 'M1', threadId: 'T1', from: [{ name: 'Dana', email: 'dana@example.com' }], to: [{ email: us.email }], cc: null,
      replyTo: null, subject: 'Dinner', receivedAt: '2026-11-10T09:00:00Z', messageId: ['a@example.com'], references: null,
      keywords: {}, text: 'Are you free on the 12th?', truncated: false,
    },
  ],
};

/** A fetch that answers like the Messages API in streaming mode. */
function streamingFetch(pieces: string[], stopReason = 'end_turn') {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const events = [
      ...pieces.map((text) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })),
      { type: 'message_delta', delta: { stop_reason: stopReason } },
    ];
    // Split mid-event to prove the parser copes with arbitrary chunk borders.
    const wire = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const half = Math.floor(wire.length / 2);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(wire.slice(0, half)));
        controller.enqueue(encoder.encode(wire.slice(half)));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  });
  return { fetchFn, calls };
}

describe('rules that must keep holding', () => {
  const sources = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  it('never mentions sending: no submission capability, EmailSubmission or Identity calls', () => {
    for (const file of sources('src')) {
      const code = read(file);
      expect(code, file).not.toMatch(/jmap:submission|EmailSubmission|Identity\/(get|set|changes)/);
    }
  });

  it('keeps the content script free of imports', () => {
    expect(read('src/content.ts')).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('asks for exactly three hosts in both browsers', () => {
    const hosts = ['https://app.fastmail.com/*', 'https://api.fastmail.com/*', 'https://api.anthropic.com/*'];
    for (const target of ['chrome', 'firefox'] as const) {
      const built = manifest(target, '1.2.3');
      expect(built.host_permissions).toEqual(hosts);
      expect(built.content_scripts[0]?.matches).toEqual([hosts[0]]);
      expect(built.version).toBe('1.2.3');
    }
    expect(manifest('chrome', '1').permissions).toEqual(['sidePanel', 'storage']);
    expect(manifest('firefox', '1').permissions).toEqual(['storage']);
  });

  it('recognises a conversation URL the same way in the page and in the library', () => {
    const literal = /const CONVERSATION_ID = \/(.+)\/;/.exec(read('src/content.ts'))?.[1];
    expect(literal).toBeTruthy();
    const inPage = new RegExp(literal!);
    for (const path of ['/mail/Inbox/Tabc123def456.M0123456789ab', '/mail/Inbox/', '/mail/Marketing/Team', '/mail/Inbox/M0123456789ab']) {
      const library = parseMailContext(`https://app.fastmail.com${path}`);
      expect(inPage.test(`${path} `), path).toBe(Boolean(library.threadId || library.emailId));
    }
  });
});

describe('Claude client', () => {
  it('assembles a streamed reply and reports progress', async () => {
    const { fetchFn, calls } = streamingFetch(['Hi Da', 'na,\n\nYes', '!']);
    vi.stubGlobal('fetch', fetchFn);
    const seen: string[] = [];
    const result = await streamMessage({ apiKey: 'k', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }], onText: (t) => seen.push(t) });
    expect(result).toEqual({ text: 'Hi Dana,\n\nYes!', truncated: false });
    expect(seen.at(-1)).toBe('Hi Dana,\n\nYes!');
    expect(calls[0]?.body.stream).toBe(true);
    expect(calls[0]?.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    vi.unstubAllGlobals();
  });

  it('retries without the optional fields when the API rejects them', async () => {
    const good = streamingFetch(['Fine.']);
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'unknown field' } }), { status: 400 }))
      .mockImplementation(good.fetchFn);
    vi.stubGlobal('fetch', fetchFn);
    const result = await streamMessage({ apiKey: 'k', model: 'claude-sonnet-5-5', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Fine.');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(good.calls[0]?.body).not.toHaveProperty('output_config');
    expect(good.calls[0]?.body).not.toHaveProperty('fallbacks');
    vi.unstubAllGlobals();
  });

  it('sends the plain request to a model it does not know, and flags a cut-off draft', async () => {
    const { fetchFn, calls } = streamingFetch(['Partial'], 'max_tokens');
    vi.stubGlobal('fetch', fetchFn);
    const result = await streamMessage({ apiKey: 'k', model: 'some-other-model', system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(result.truncated).toBe(true);
    expect(calls[0]?.body).not.toHaveProperty('output_config');
    expect(calls[0]?.headers).not.toHaveProperty('anthropic-beta');
    vi.unstubAllGlobals();
  });

  it('turns a refusal and an API error into readable messages', async () => {
    vi.stubGlobal('fetch', streamingFetch([], 'refusal').fetchFn);
    await expect(streamMessage({ apiKey: 'k', model: 'm', system: 's', messages: [] })).rejects.toThrow('declined');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })));
    await expect(streamMessage({ apiKey: 'k', model: 'm', system: 's', messages: [] })).rejects.toThrow('invalid x-api-key');
    vi.unstubAllGlobals();
  });
});

describe('drafting engine', () => {
  it('revises from the draft on screen', () => {
    const chat = buildChat({ settings, identity: us, mode: 'reply', thread, instruction: 'Say yes', current: 'Yes!', revision: 'warmer' });
    expect(chat.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(chat[0]?.content).toContain('<thread>');
    expect(chat[1]?.content).toBe('Yes!');
    expect(chat[2]?.content).toBe('Revise the draft: warmer');
  });

  it('splits the subject from a new email and never shows half a subject line', async () => {
    vi.stubGlobal('fetch', streamingFetch(['Subj', 'ect: Friday', ' dinner\n\nHi Dana,', '\nCome over.']).fetchFn);
    const progress: string[] = [];
    const result = await draftEmail({ settings, identity: us, mode: 'compose', instruction: 'invite', onProgress: (d) => progress.push(d.body) });
    expect(result).toEqual({ subject: 'Friday dinner', body: 'Hi Dana,\nCome over.', truncated: false });
    expect(progress.some((body) => /subj/i.test(body))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('settings and URLs', () => {
  it('fills in fields added after the settings were first saved', () => {
    const old = withDefaults({ fastmailToken: 't', anthropicKey: 'k', model: 'm', identities: [us] });
    expect(old.inPage).toEqual({ toolbarButton: true, editorChip: true });
    expect(withDefaults({ inPage: { toolbarButton: false } as never }).inPage).toEqual({ toolbarButton: false, editorChip: true });
    expect(withDefaults(undefined).identities).toEqual([]);
  });

  it('stores settings as plain data, since Firefox cannot structured-clone a reactive proxy', async () => {
    const set = vi.fn(async () => {});
    vi.stubGlobal('chrome', { storage: { local: { set } } });
    try {
      await saveSettings(reactive(withDefaults({ fastmailToken: 't', anthropicKey: 'k', identities: [us] })));
    } finally {
      vi.unstubAllGlobals();
    }
    const written = (set.mock.calls[0] as unknown[])[0] as { settings: Settings };
    // Node's structuredClone throws DataCloneError on a Proxy exactly as Firefox does.
    expect(() => structuredClone(written)).not.toThrow();
    expect(written.settings.identities).toEqual([us]);
    expect(written.settings.inPage).toEqual({ toolbarButton: true, editorChip: true });
  });

  it('links to Drafts for the same Fastmail user', () => {
    expect(draftsUrl('https://app.fastmail.com/mail/Inbox/Tabc123def456?u=1a2b3c4d')).toBe('https://app.fastmail.com/mail/Drafts/?u=1a2b3c4d');
    expect(draftsUrl(undefined)).toBe('https://app.fastmail.com/mail/Drafts/');
  });
});

describe('secret scan', () => {
  // Built from pieces so that this file does not trip the scan itself.
  const fake = (prefix: string, length: number) => prefix + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'.repeat(3).slice(0, length);

  it('flags keys, tokens and real-looking addresses', () => {
    expect(scanText(`const key = "${fake('sk-' + 'ant-api03-', 40)}"`).map((f) => f.rule)).toContain('Anthropic API key');
    expect(scanText(fake('fmu1' + '-', 8) + '-' + fake('', 24)).map((f) => f.rule)).toContain('Fastmail API token');
    expect(scanText('Authorization: Bearer ' + fake('', 32)).map((f) => f.rule)).toContain('Bearer token');
    expect(scanText('-----BEGIN ' + 'PRIVATE KEY-----')).toHaveLength(1);
    expect(scanText('write to someone' + '@' + 'fastmail.com')).toEqual([{ line: 1, rule: 'Email address outside the example domains' }]);
  });

  it('accepts example addresses, package versions and ordinary code', () => {
    const clean = ['dana@example.com, us@example.org', 'vue@3.5.45 and @types/node@26.6.6', "headers: { Authorization: `Bearer ${this.token}` }", 'const token = settings.fastmailToken;'];
    expect(scanText(clean.join('\n'))).toEqual([]);
  });
});

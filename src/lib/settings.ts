import type { Settings } from './types';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Offered in the settings page; any other model id can still be typed in. */
export const SUGGESTED_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

const KEY = 'settings';

export const emptySettings = (): Settings => ({
  fastmailToken: '',
  anthropicKey: '',
  model: DEFAULT_MODEL,
  identities: [],
  inPage: { toolbarButton: true, editorChip: true },
});

/** Stored settings may predate newer fields, so fill the gaps with defaults. */
export function withDefaults(stored: Partial<Settings> | undefined): Settings {
  const base = emptySettings();
  return {
    ...base,
    ...stored,
    identities: Array.isArray(stored?.identities) ? stored.identities : base.identities,
    inPage: { ...base.inPage, ...stored?.inPage },
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return withDefaults(stored[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.fastmailToken && s.anthropicKey && s.identities.length > 0);
}

export function onSettingsChanged(callback: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[KEY];
    if (area === 'local' && change) callback(withDefaults(change.newValue as Partial<Settings> | undefined));
  });
}

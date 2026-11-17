import type { Settings } from './types';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const KEY = 'settings';

export const emptySettings = (): Settings => ({
  fastmailToken: '',
  anthropicKey: '',
  model: DEFAULT_MODEL,
  identities: [],
});

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return { ...emptySettings(), ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.fastmailToken && s.anthropicKey && s.identities.length > 0);
}

export function onSettingsChanged(callback: (s: Settings) => void): void {
  chrome.storage.local.onChanged.addListener((changes) => {
    const change = changes[KEY];
    if (change) callback({ ...emptySettings(), ...(change.newValue as Partial<Settings>) });
  });
}

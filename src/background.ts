// Service worker. Its only jobs are to open the side panel and to keep stored
// keys out of reach of content scripts. All mail and model traffic happens in
// the side panel page.

const OPEN_PANEL = 'fa:open-panel';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // storage.local is readable from content scripts unless restricted.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const type = (message as { type?: string } | null)?.type;
  if (type !== OPEN_PANEL || sender.tab?.id === undefined) return;
  // Must run inside the click's user-gesture window, so nothing is awaited first.
  void chrome.sidePanel.open({ tabId: sender.tab.id });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab?.id !== undefined) {
    void chrome.sidePanel.open({ tabId: tab.id });
  }
});

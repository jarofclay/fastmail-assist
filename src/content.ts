// Content script for app.fastmail.com. Adds one floating button that opens
// the side panel. It deliberately does not read or modify Fastmail's own
// markup: mail content comes from the JMAP API, and the open conversation is
// read from the tab URL by the panel.
//
// Keep this file free of imports. Content scripts are classic scripts, so a
// shared chunk would break loading.

(() => {
  const HOST_ID = 'fastmail-assist-launcher';
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Shadow root so Fastmail's styles and ours cannot affect each other.
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    button {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483000;
      padding: 9px 14px;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 999px;
      background: #1f2a44;
      color: #fff;
      font: 600 13px/1 system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    }
    button:hover { background: #2c3a5e; }
    button:focus-visible { outline: 2px solid #7aa7ff; outline-offset: 2px; }
  `;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Draft with AI';
  button.title = 'Open Fastmail Assist (Alt+Shift+R)';
  button.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'fa:open-panel' });
  });

  root.append(style, button);
  document.documentElement.append(host);
})();

// The two browsers need slightly different manifests; everything else in the
// build is identical. Chrome has a side panel and a service worker, Firefox a
// sidebar and an event page.

const HOSTS = ['https://app.fastmail.com/*', 'https://api.fastmail.com/*', 'https://api.anthropic.com/*'];

const ICONS = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

/** @param {'chrome' | 'firefox'} target @param {string} version */
export function manifest(target, version) {
  const shared = {
    manifest_version: 3,
    name: 'Fastmail Assist',
    version,
    description: 'Say in a line what an email should say and get a draft in your voice, right inside Fastmail. Never sends.',
    icons: ICONS,
    host_permissions: HOSTS,
    action: { default_title: 'Open Fastmail Assist', default_icon: ICONS },
    options_ui: { page: 'options.html', open_in_tab: true },
    content_scripts: [
      {
        matches: ['https://app.fastmail.com/*'],
        js: ['content.js'],
        // Early, so its keyboard guard is in place before Fastmail's shortcuts.
        run_at: 'document_start',
      },
    ],
  };
  const quickDraft = {
    suggested_key: { default: 'Alt+Shift+D' },
    description: 'Open the composer inside Fastmail',
  };

  if (target === 'chrome') {
    return {
      ...shared,
      minimum_chrome_version: '116',
      permissions: ['sidePanel', 'storage'],
      background: { service_worker: 'background.js' },
      side_panel: { default_path: 'sidepanel.html' },
      commands: {
        'open-panel': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Open the side panel' },
        'quick-draft': quickDraft,
      },
    };
  }

  return {
    ...shared,
    permissions: ['storage'],
    background: { scripts: ['background.js'] },
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_title: 'Fastmail Assist',
      default_icon: ICONS,
      open_at_install: false,
    },
    commands: {
      _execute_sidebar_action: { suggested_key: { default: 'Alt+Shift+R' }, description: 'Open the sidebar' },
      'quick-draft': quickDraft,
    },
    browser_specific_settings: {
      gecko: {
        id: 'fastmail-assist@extensions.invalid',
        strict_min_version: '140.0',
        // The open conversation is sent to the Claude API to write the draft.
        data_collection_permissions: { required: ['personalCommunications'] },
      },
      // Firefox for Android learned the data-collection declaration in 142;
      // without this AMO's validator warns. Nothing else here is Android-specific.
      gecko_android: { strict_min_version: '142.0' },
    },
  };
}

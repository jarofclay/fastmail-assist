# Fastmail Assist

Chrome side-panel assistant for Fastmail's web app. Give a line of context, get a reply or a new email in your own voice, saved to your Fastmail Drafts. It cannot send mail.

See [DESIGN.md](DESIGN.md) for the architecture, security model, open questions and milestones, and [AGENTS.md](AGENTS.md) for the current state and what to do next.

## Build

Requires Node 20 or newer.

```sh
npm install
npm run build      # outputs dist/
npm run check      # typecheck, tests and build
npm run dev        # rebuild on change
```

## Load in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `dist` folder.
3. Open the extension's settings (Details → Extension options) and add:
   - a Fastmail API token (Fastmail → Settings → Privacy & Security → Manage API tokens) with mail access and without sending,
   - a Claude API key,
   - one identity per address you write from, with a few voice notes each.
4. Use **Test connection**, then open a conversation at app.fastmail.com and click **Draft with AI** (or press Alt+Shift+R).

After `npm run build`, press the reload icon on the extension card to pick up changes.

## Layout

```
public/manifest.json     Manifest V3
src/content.ts           floating button on app.fastmail.com
src/background.ts        opens the side panel
src/sidepanel/           the panel (Vue)
src/options/             settings page (Vue)
src/lib/                 JMAP client, Claude client, reply and prompt logic
tests/                   unit tests for src/lib
```
# fastmail-assist

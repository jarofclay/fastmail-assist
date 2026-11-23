# Fastmail Assist

A browser extension for Fastmail's web app, for Chrome and Firefox. Say in a line what an email should say and get a draft in your own voice, written straight into your open draft or saved to your Fastmail Drafts. It cannot send mail.

See [DESIGN.md](DESIGN.md) for the architecture, security model, open questions and milestones, and [AGENTS.md](AGENTS.md) for the current state and what to do next.

## Using it

Inside Fastmail:

- **Reply with AI** sits next to Fastmail's Reply button and as a floating button bottom right. It opens a small composer: type what the reply should say, press Draft, edit or revise, then **Save to Drafts**.
- With a draft open in Fastmail (after Reply, or in a new message), a **✦** button appears in the corner of the editor and the composer offers **Insert into draft**, which writes the text at the cursor. Fastmail keeps handling recipients, the quote and your signature.
- **Alt+Shift+D** opens the composer, **Esc** closes it.

The side panel (Chrome) or sidebar (Firefox), **Alt+Shift+R**, has the same flow plus a list of recent conversations and a full new-email form with To and Subject.

## Build

Requires Node 20 or newer.

```sh
npm install        # also installs the pre-push secret scan
npm run build      # outputs dist/chrome and dist/firefox
npm run check      # secret scan, typecheck, unit tests and build
npm run dev        # rebuild on change
npm run package    # check, then zip both builds into dist/
```

## Load in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `dist/chrome` folder.

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `dist/firefox/manifest.json`.

A temporary add-on goes away when Firefox restarts. To keep it installed it has to be signed by Mozilla; `npm run package` produces the zip to upload as an unlisted add-on. Needs Firefox 140 or newer.

## Set up

Open the extension's settings and add:

- a Fastmail API token (Fastmail → Settings → Privacy & Security → Manage API tokens) with mail access and without sending,
- a Claude API key,
- one identity per address you write from, with a few voice notes each.

Use both **Test connection** buttons, then open a conversation at app.fastmail.com.

After `npm run build`, press the reload icon on the extension card and reload the Fastmail tab to pick up changes.

## Before pushing

`npm run scan` looks for keys, tokens and real email addresses in the working tree. The pre-push hook runs the same scan over every commit about to be pushed and refuses the push if it finds anything. Tests and fixtures use `example.org` addresses only.

## Tests

```sh
npm test           # unit tests
npm run e2e        # loads the built extension in Chromium against a stand-in server
```

`npm run e2e` needs Playwright with Chromium available on the machine; it is not a dependency of this project. It never touches a real account.

## Layout

```
scripts/build.mjs        builds dist/chrome and dist/firefox
scripts/manifest.mjs     the manifest for each browser
scripts/scan-secrets.mjs secret scan
src/content.ts           everything shown inside the Fastmail page
src/background.ts        mail and model work for the in-page composer; opens the panel
src/sidepanel/           side panel / sidebar (Vue)
src/options/             settings page (Vue)
src/lib/                 JMAP client, Claude client, reply and prompt logic
tests/                   unit tests, and tests/e2e for the browser test
```

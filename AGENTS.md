# Handoff notes for the next agent

Read this first, then [DESIGN.md](DESIGN.md) for the architecture and the reasons behind it.

## What this is

A browser extension (Manifest V3) for Fastmail's web app, built for Chrome and Firefox from one codebase. The owner gives a one-line instruction, in a composer inside the Fastmail page or in the side panel; the extension reads the open conversation over JMAP, drafts a reply or new email with the Claude API in the voice of the chosen sending identity, and either writes it into the draft that is open in Fastmail or saves it to Fastmail Drafts. A person reviews and sends in Fastmail. It replaces the AI-reply feature the owner used in Missive.

## State at handoff (v0.2.0)

Working and checked:

- `npm run check` passes: secret scan, `vue-tsc` typecheck, 29 unit tests, production build of `dist/chrome` and `dist/firefox`. `dist/` is gitignored.
- `npm run e2e` passes (15 steps): the Chrome build loaded into Chromium and driven against a stand-in server (`tests/e2e/server.mjs`) that plays app.fastmail.com, the JMAP API and the Claude API. It covers settings, the in-page composer, streaming, revise, Save to Drafts, Insert into a Squire editor (the editor Fastmail uses), the side panel, and that typing in the composer does not reach the page's keyboard shortcuts.
- The Firefox build passes Mozilla's linter (`npx web-ext lint -s dist/firefox`) with no errors.

Not done, and not to be assumed working:

- **Nothing has run against the real Fastmail web app, a real Fastmail account or the real Claude API.** `src/lib/jmap.ts` and `src/lib/claude.ts` are written from the published API docs.
- **The in-page pieces have only met a mock page.** The toolbar button finds Fastmail's Reply button by its label, and the draft-editor chip and Insert find the editor by it being a large focused editable element. Whether Fastmail's real page behaves like the mock is the first thing to check.
- **The Firefox build has never been loaded in Firefox** (none was available where it was built).
- The real side panel has never been opened; the e2e test loads `sidepanel.html` as a tab.

## Next task: milestone M1

Goal: one real reply drafted, threaded correctly, and sent by the owner from Fastmail. The owner has to be at the keyboard for this (their browser, their tokens). Work through these in order and record each answer in DESIGN.md under "Open questions".

1. `npm install`, `npm run build`, load `dist/chrome` at `chrome://extensions`, open the options page. Fix whatever breaks.
2. **Fastmail URL format** (open question 1). Ask the owner for the URL shape of an open conversation in each view they use, and of an open draft, with ids intact. `src/lib/fastmailUrl.ts` assumes a `T<hex>` thread id and `M<hex>` email id somewhere in the path or hash; `src/content.ts` repeats the pattern (a unit test keeps the two in step). Fix both and the tests if that is wrong. The recent-conversations picker in the side panel works regardless.
3. **Token scopes** (open question 2). Have the owner create a Fastmail API token with mail access and without sending, then use Test connection. Confirm `Email/set` can create a draft with that token.
4. **In-page pieces on the real page** (open question 8). With a conversation open: does "Reply with AI" appear next to Reply, and does it look right in the toolbar? Click Reply: does the ✦ chip appear in the editor, and does Insert put the text at the cursor, above the quote and signature? Type in the composer: does anything in Fastmail react to the keys? If the toolbar button misbehaves it can be switched off in the settings without losing anything else.
5. **Draft visibility** (open question 3). After Save to Drafts, check whether the draft appears in the open conversation without a reload, with the right From, To, Cc, subject, and quoted original.
6. Check the background worker's console and the page console for errors during a full reply and a full compose.
7. **Firefox** (open question 9). Load `dist/firefox/manifest.json` at `about:debugging` and repeat steps 3 to 6.

Then continue with M2 in DESIGN.md.

## Commands

```sh
npm install        # run on the owner's machine; see the warning below
npm run check      # secret scan + typecheck + tests + build; run before every commit
npm run scan       # the secret scan alone
npm run dev        # rebuild both targets on change, then reload the extension and the Fastmail tab
npm test           # vitest
npm run e2e        # browser test against the stand-in server; needs Playwright with Chromium
npm run package    # zips of both builds in dist/
```

## Rules that must keep holding

- **Scan for secrets before every push.** `node scripts/scan-secrets.mjs --push` checks the working tree and every commit not yet on a remote (messages included) for API keys, tokens, private keys and real email addresses. The pre-push hook in `.githooks/` runs it; `npm install` enables the hook. Never push with `--no-verify`, and if the scan flags something, remove it from the commits rather than silencing the rule.
- **Never send mail.** Do not add `urn:ietf:params:jmap:submission` to the JMAP `using` list and do not call `EmailSubmission/*` or `Identity/*`. Tests assert this over all of `src/`. If a feature seems to need the submission scope (signatures, identity list), stop and ask the owner; DESIGN.md open questions 4 and 7 describe the trade-off.
- **Do not read mail content from the page.** Content comes from JMAP, the open conversation from the tab URL. The content script adds UI and writes the finished draft into the open editor; the only things it reads from the page are the URL, button labels (to find Reply), element sizes, and the amount of text in the draft editor (to see that an insert worked). Nothing the flow cannot do without may depend on Fastmail's markup: the floating button and Save to Drafts are the fallbacks and must keep working with no knowledge of the page.
- **`src/content.ts` has no imports.** Content scripts load as classic scripts. Its message types are ambient, in `src/protocol.d.ts`. A unit test checks the source; the build fails if `dist/*/content.js` or `background.js` contains `import` or `export`.
- **Keys and raw mail stay out of the page.** The content script sends the page URL and the instruction to the background worker and gets back a subject line, a sender name and the draft. Do not add a message that returns settings, tokens or message bodies to it.
- **The composer keeps its keystrokes from Fastmail.** Fastmail has single-letter shortcuts that act on mail. `src/content.ts` stops key and clipboard events that come from its own UI at `window`, in the capture phase, and the content script runs at `document_start` so that this listener is registered first. Do not move it later or handle keys inside the shadow root instead.
- **Email text is untrusted.** Keep it inside the `<thread>` fence built in `src/lib/prompt.ts`, and keep stripping fence tags from it.
- **No secrets or personal data in the repo.** Tokens, keys, real addresses and real email text stay out of code, tests, fixtures and commit messages. Tests use `example.org` addresses.
- **Host permissions stay minimal:** `app.fastmail.com`, `api.fastmail.com`, `api.anthropic.com`, in both browsers. Adding one needs a reason in DESIGN.md.
- The owner reviews every draft. Do not add auto-send, auto-archive, or any action on mail beyond creating a draft or writing into the draft the owner has open.

## Things that will trip you up

- **Install dependencies on the machine that runs the build.** Vite 8 pulls platform-specific native binaries. Do not run `npm install` from a Linux sandbox into a folder the owner then uses from macOS.
- **Vite 8 / TypeScript 6 / Vitest 5 / Vue 3.5** are the installed majors. The extension is built by `scripts/build.mjs` (three Vite runs: pages, background, content script); `vite.config.ts` is only for Vitest.
- **One codebase, two manifests.** `scripts/manifest.mjs` produces both. Chrome gets a service worker and `side_panel`; Firefox gets an event page and `sidebar_action`. The code tells them apart at run time (`chrome.sidePanel` exists or not), never at build time.
- **`chrome.sidePanel.open()` needs a user gesture.** `src/background.ts` calls it straight away in the message handler. Do not put an `await` before it. Firefox cannot open its sidebar from a click in the page at all, so the composer hides that button there (`canOpenPanel`).
- **The background worker can be stopped at any time** (Chrome service worker). It keeps nothing that matters in memory; the content script reconnects its port on the next request.
- **Claude API from an extension** needs the `anthropic-dangerous-direct-browser-access: true` header (already set). An API key from an organisation with zero data retention will be rejected with that header; the fix would be a small proxy, which DESIGN.md lists under alternatives.
- **The Claude request streams**, asks for low effort, and opts into the server-side fallback for declined requests (a beta header). If the API answers 400, `src/lib/claude.ts` retries once without those optional fields. This path has only been tested against a fake `fetch`.
- **Default model** is `claude-sonnet-5-5` in `src/lib/settings.ts`, editable in the options page. Check the current model list before changing it.
- **HTML-only emails** go through a crude `htmlToText` in `src/lib/jmap.ts`. Good enough as model input, not for display.
- **Only the token owner's primary JMAP account is used.** Mail in folders shared from another Fastmail user lives under a different account id (DESIGN.md open question 6).
- **The e2e build is not the shipping build.** `npm run e2e` builds with `FA_E2E=1`, which opens the content script's shadow root so the test can reach it. Run `npm run build` again before loading or packaging.

## Map

```
scripts/build.mjs           builds dist/chrome and dist/firefox
scripts/manifest.mjs        the manifest for each browser
scripts/scan-secrets.mjs    secret scan (npm run scan, pre-push hook)
scripts/package.mjs         zips both builds
scripts/make-icons.mjs      regenerates public/icons from the SVG inside it
sidepanel.html, options.html  Vite entry pages
src/content.ts              in-page UI: launcher, toolbar button, draft-editor chip, composer
src/protocol.d.ts           message types between content script and background
src/background.ts           handles the composer's requests; opens the panel; locks storage
src/sidepanel/App.vue       side panel / sidebar: the full flow, with recent conversations
src/options/Options.vue     settings: token, key, model, identities with voice notes, in-page toggles
src/styles.css              shared look of the panel and settings (the composer carries its own copy)
src/lib/engine.ts           drafting and revising, shared by the panel and the background
src/lib/jmap.ts             JMAP client: getThread, recentThreads, createDraft
src/lib/claude.ts           one streamed Messages API call
src/lib/reply.ts            reply target, recipients, subject, threading headers, quoting (pure)
src/lib/prompt.ts           system prompt, fenced thread, compose output parsing (pure)
src/lib/fastmailUrl.ts      tab URL to thread/email id (assumption, see M1 step 2)
src/lib/settings.ts         chrome.storage.local wrapper
src/lib/types.ts            shared types
tests/lib.test.ts           unit tests for the reply, prompt and JMAP logic
tests/extension.test.ts     unit tests for the rules above, streaming, the engine, the scan
tests/e2e/                  stand-in server and the browser smoke test
```

## About the owner's setup

- Uses Fastmail's web app in Chrome on macOS, with several sending identities; one is a shared ministry address used with their spouse, who is the intended second user (M3).
- Wants a single unified place for mail and as few extra windows as possible, which is why this lives inside the Fastmail tab.
- Moved off Google and Missive deliberately. Do not add dependencies on Google services or on a hosted backend without asking.
- The repository's remote is `origin` on GitHub. Push only to the branch you were asked to work on, and only after the secret scan is clean.

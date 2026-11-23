# Handoff notes for the next agent

Read this first, then [DESIGN.md](DESIGN.md) for the architecture and the reasons behind it.

## What this is

A browser extension (Manifest V3) for Fastmail's web app, built for Chrome and Firefox from one codebase. The owner gives a one-line instruction, in a composer inside the Fastmail page or in the side panel; the extension reads the open conversation and the recent earlier mail with the recipient over JMAP, drafts a reply or new email with the Claude API in the voice of the chosen sending identity, and either writes it into the draft that is open in Fastmail or saves it to Fastmail Drafts. A person reviews and sends in Fastmail. It replaces the AI-reply feature the owner used in Missive.

## State at handoff (v0.4.0)

Working and checked:

- `npm run check` passes: secret scan, `vue-tsc` typecheck, 38 unit tests, production build of `dist/chrome` and `dist/firefox`. `dist/` is gitignored.
- `npm run e2e` passes (19 steps): the Chrome build loaded into Chromium and driven against a stand-in server (`tests/e2e/server.mjs`) that plays app.fastmail.com, the JMAP API (mail and contacts) and the Claude API. It covers settings, the in-page composer, the whole-thread prompt with the earlier-mail background, streaming, revise, Save to Drafts for replies and for new emails, the To field's autocomplete, Insert into a Squire editor (the editor Fastmail uses), the side panel, and that typing in the composer does not reach the page's keyboard shortcuts.
- The Firefox build passes Mozilla's linter (`npx web-ext lint -s dist/firefox`) with no errors.
- CI (`.github/workflows/ci.yml`) runs the check and the browser test on pull requests; a `v*` tag publishes a GitHub release with both zips (`.github/workflows/release.yml`). `CHANGELOG.md` is the source of the release notes.

New in v0.4.0: the floating launcher is one compact control, "Reply with AI | New" when a conversation is open (the editor chip is gone, and so is its setting); store submission material under `store/` with `PRIVACY.md`; releases carry a source archive for AMO. New in v0.3.1: the real Fastmail URL shape is read, and To is prefilled for replies. New in v0.3.0: the prompt carries the whole conversation with its participants (older messages shortened, quoted repeats stripped) and a fenced `<history>` block of recent earlier conversations with the recipient (setting `history`, on by default); the in-page composer has a To field with autocomplete from Fastmail Contacts and recent correspondents, an editable Subject, and Save to Drafts for new emails; the icon is a reply arrow with a sparkle.

Not done, and not to be assumed working:

- **Almost nothing has run against the real Fastmail web app, a real Fastmail account or the real Claude API.** The one thing that has: v0.3.0 on the owner's Fastmail, which showed the URL parser never matched a real conversation (fixed in v0.3.1). `src/lib/jmap.ts` and `src/lib/claude.ts` are written from the published API docs. In particular the contacts calls (`ContactCard/query` with a `text` filter, JSContact cards) and the `Email/query` filters used for history and people search are unverified (DESIGN.md open questions 10 and 11). Both fail soft: no contacts means suggestions come from mail only; a failed history lookup means the draft goes without it.
- **The in-page pieces have only met a mock page.** The toolbar button finds Fastmail's Reply button by its label, and the draft-editor chip and Insert find the editor by it being a large focused editable element. Whether Fastmail's real page behaves like the mock is the first thing to check.
- **The Firefox build has been loaded in Firefox only once**, far enough to find and fix a settings bug; the sidebar and the in-page flow there are unverified.
- The real side panel has never been opened; the e2e test loads `sidepanel.html` as a tab.
- The release workflow has never run; the first `v0.3.0` tag will be its first run.

## Next task: milestone M1

Goal: one real reply drafted, threaded correctly, and sent by the owner from Fastmail. The owner has to be at the keyboard for this (their browser, their tokens). Work through these in order and record each answer in DESIGN.md under "Open questions".

1. `npm install`, `npm run build`, load `dist/chrome` at `chrome://extensions`, open the options page. Fix whatever breaks.
2. **Fastmail URL format** (open question 1). Settled in v0.3.1: `/mail/<Mailbox>/<threadId>.<emailId>?u=…` with `A…` thread ids and `S…` email ids (twelve base64url characters). `src/lib/fastmailUrl.ts` and the identical literal in `src/content.ts` read that (a unit test keeps the two equal). Left to check at the keyboard: the URL while a draft is open, and in search results. If either differs, those two files and the tests are the only places to change.
3. **Token scopes** (open question 2). Have the owner create a Fastmail API token with Email and Contacts and without Email submission, then use Test connection. It should say the inbox and contacts are readable. Confirm `Email/set` can create a draft with that token.
   - **Contacts and history** (open questions 10 and 11). In the composer with no conversation, type two letters of a known contact's name into To: do address-book matches appear? Open a conversation with someone the owner has written to before: does the subtitle show "N earlier conversations with …" within a second or two, and does the drafted reply use the right name? Check the background worker's console for a JMAP error on `ContactCard/query` or `Email/query`; if the filter shape is the problem, `src/lib/jmap.ts` is the only place to change.
4. **In-page pieces on the real page** (open question 8). With a conversation open: does "Reply with AI" appear next to Reply, and does it look right in the toolbar? Does the floating button read "Reply with AI | New"? Click Reply in Fastmail: does Insert put the text at the cursor, above the quote and signature? Type in the composer: does anything in Fastmail react to the keys? If the toolbar button misbehaves it can be switched off in the settings without losing anything else.
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
npm run release    # after a version bump and a CHANGELOG entry: checks, then tags v<version>; push the tag to publish
```

## Rules that must keep holding

- **Scan for secrets before every push.** `node scripts/scan-secrets.mjs --push` checks the working tree and every commit not yet on a remote (messages included) for API keys, tokens, private keys and real email addresses. The pre-push hook in `.githooks/` runs it; `npm install` enables the hook. Never push with `--no-verify`, and if the scan flags something, remove it from the commits rather than silencing the rule.
- **Never send mail.** Do not add `urn:ietf:params:jmap:submission` to the JMAP `using` list and do not call `EmailSubmission/*` or `Identity/*`. Tests assert this over all of `src/`. The `contacts` capability is used only for `ContactCard/*` lookups (the browser test checks that too). If a feature seems to need the submission scope (signatures, identity list), stop and ask the owner; DESIGN.md open questions 4 and 7 describe the trade-off.
- **Do not read mail content from the page.** Content comes from JMAP, the open conversation from the tab URL. The content script adds UI and writes the finished draft into the open editor; the only things it reads from the page are the URL, button labels (to find Reply), element sizes, and the amount of text in the draft editor (to see that an insert worked). Nothing the flow cannot do without may depend on Fastmail's markup: the floating button and Save to Drafts are the fallbacks and must keep working with no knowledge of the page.
- **`src/content.ts` has no imports.** Content scripts load as classic scripts. Its message types are ambient, in `src/protocol.d.ts`. A unit test checks the source; the build fails if `dist/*/content.js` or `background.js` contains `import` or `export`.
- **Keys and raw mail stay out of the page.** The content script sends the page URL, the instruction and the To field to the background worker and gets back a subject line, a sender name, names and addresses of matching people, a count of earlier conversations, and the draft. Do not add a message that returns settings, tokens or message bodies to it. The history messages themselves never leave the background.
- **The composer keeps its keystrokes from Fastmail.** Fastmail has single-letter shortcuts that act on mail. `src/content.ts` stops key and clipboard events that come from its own UI at `window`, in the capture phase, and the content script runs at `document_start` so that this listener is registered first. Do not move it later or handle keys inside the shadow root instead.
- **Email text is untrusted.** Keep it inside the `<thread>` and `<history>` fences built in `src/lib/prompt.ts`, and keep stripping fence tags from it. Header names and subjects go through the same `neutralise`.
- **More mail to the model needs the setting.** Anything that widens what is sent to the Claude API beyond the open conversation must sit behind `settings.history` (or a new, documented setting) and be described in DESIGN.md under "What leaves the browser" and in the settings page.
- **No secrets or personal data in the repo.** Tokens, keys, real addresses and real email text stay out of code, tests, fixtures and commit messages. Tests use `example.org` addresses.
- **Host permissions stay minimal:** `app.fastmail.com`, `api.fastmail.com`, `api.anthropic.com`, in both browsers. Adding one needs a reason in DESIGN.md.
- The owner reviews every draft. Do not add auto-send, auto-archive, or any action on mail beyond creating a draft or writing into the draft the owner has open.

## Things that will trip you up

- **Install dependencies on the machine that runs the build.** Vite 8 pulls platform-specific native binaries. Do not run `npm install` from a Linux sandbox into a folder the owner then uses from macOS.
- **Vite 8 / TypeScript 6 / Vitest 5 / Vue 3.5** are the installed majors. The extension is built by `scripts/build.mjs` (three Vite runs: pages, background, content script); `vite.config.ts` is only for Vitest.
- **One codebase, two manifests.** `scripts/manifest.mjs` produces both. Chrome gets a service worker and `side_panel`; Firefox gets an event page and `sidebar_action`. The code tells them apart at run time (`chrome.sidePanel` exists or not), never at build time.
- **`chrome.sidePanel.open()` needs a user gesture.** `src/background.ts` calls it straight away in the message handler. Do not put an `await` before it. Firefox cannot open its sidebar from a click in the page at all, so the composer hides that button there (`canOpenPanel`).
- **The Chrome side panel is tab-specific.** The default panel is disabled and `src/background.ts` enables it per tab for `app.fastmail.com` only (at worker start and on `tabs.onUpdated`), otherwise Chrome's window-wide panel appears in every new tab. Without the `tabs` permission a tab's URL is readable only on Fastmail, so an unreadable URL on navigation means "not Fastmail" and the panel is disabled for that tab. `sidePanel.open()` for a tab where it is disabled rejects; the command and action handlers bring a Fastmail tab to the front instead.
- **The background worker can be stopped at any time** (Chrome service worker). It keeps nothing that matters in memory; the content script reconnects its port on the next request.
- **Claude API from an extension** needs the `anthropic-dangerous-direct-browser-access: true` header (already set). An API key from an organisation with zero data retention will be rejected with that header; the fix would be a small proxy, which DESIGN.md lists under alternatives.
- **The Claude request streams**, asks for low effort, and opts into the server-side fallback for declined requests (a beta header). If the API answers 400, `src/lib/claude.ts` retries once without those optional fields. This path has only been tested against a fake `fetch`.
- **Default model** is `claude-sonnet-5-5` in `src/lib/settings.ts`, editable in the options page. Check the current model list before changing it.
- **HTML-only emails** go through a crude `htmlToText` in `src/lib/jmap.ts`. Good enough as model input, not for display.
- **Only the token owner's primary JMAP account is used.** Mail in folders shared from another Fastmail user lives under a different account id (DESIGN.md open question 6).
- **The e2e build is not the shipping build.** `npm run e2e` builds with `FA_E2E=1`, which opens the content script's shadow root so the test can reach it. Run `npm run build` again before loading or packaging.
- **Events inside the composer never reach listeners in the shadow root** for the guarded types (keys, input, clipboard): the window capture listener in `src/content.ts` stops them and dispatches itself. Handle a new input's `input` or key events there (see how the To field is wired), not with `addEventListener` on the element.
- **The screenshots in `docs/`** come from `FA_SHOTS=dir npm run e2e` (the `card-*.png` files), so they show the stand-in page. Regenerate them when the composer's look changes.
- **Releases are tag-driven.** `scripts/release-notes.mjs --check` refuses a tag whose version is not in both `package.json` and `CHANGELOG.md`; bump both before `npm run release`.

## Map

```
scripts/build.mjs           builds dist/chrome and dist/firefox
scripts/manifest.mjs        the manifest for each browser
scripts/scan-secrets.mjs    secret scan (npm run scan, pre-push hook)
scripts/package.mjs         zips both builds
scripts/make-icons.mjs      regenerates public/icons from the SVG inside it (reply arrow + sparkle)
scripts/release.mjs         npm run release: checks, then tags v<version>
scripts/release-notes.mjs   release notes from CHANGELOG.md; --check verifies versions agree
scripts/store-assets.mjs    composes store/screenshots from the e2e screenshots (FA_SHOTS)
.github/workflows/          ci.yml (check + e2e on PRs), release.yml (zips + source archive on a v* tag)
CHANGELOG.md                release notes, newest first
PRIVACY.md                  the privacy policy the store listings link to
store/                      store submission texts (Chrome Web Store, AMO) and screenshots
docs/                       screenshots for the README, from the e2e test
sidepanel.html, options.html  Vite entry pages
src/content.ts              in-page UI: launcher (Reply with AI | New), toolbar button, composer
src/protocol.d.ts           message types between content script and background
src/background.ts           handles the composer's requests; opens the panel; locks storage
src/sidepanel/App.vue       side panel / sidebar: the full flow, with recent conversations
src/options/Options.vue     settings: token, key, model, identities with voice notes, history and toolbar-button switches
src/styles.css              shared look of the panel and settings (the composer carries its own copy)
src/lib/engine.ts           drafting and revising, shared by the panel and the background
src/lib/jmap.ts             JMAP client: getThread, recentThreads, correspondence, searchPeople, createDraft
src/lib/claude.ts           one streamed Messages API call
src/lib/reply.ts            reply target, correspondents, recipients, subject, threading headers, quoting (pure)
src/lib/prompt.ts           system prompt, fenced thread (participants, budget, quote stripping), fenced history, compose output parsing (pure)
src/lib/fastmailUrl.ts      tab URL to thread/email id (/mail/<Mailbox>/<A…>.<S…>; see DESIGN.md open question 1)
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

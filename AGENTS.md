# Handoff notes for the next agent

Read this first, then [DESIGN.md](DESIGN.md) for the architecture and the reasons behind it.

## What this is

A Chrome (Manifest V3) extension for Fastmail's web app. The owner gives a one-line instruction in a side panel; the extension reads the open conversation over JMAP, drafts a reply or new email with the Claude API in the voice of the chosen sending identity, and saves it to Fastmail Drafts. A person reviews and sends in Fastmail. It replaces the AI-reply feature the owner used in Missive.

## State at handoff (v0.1.0, milestone M0 done)

Working and checked:

- `npm run check` passes: `vue-tsc` typecheck, 15 unit tests (`tests/lib.test.ts`), production build.
- `dist/` in this folder is a build of the committed source, ready for Load unpacked. It is gitignored.

Not done, and not to be assumed working:

- The extension has never been loaded in Chrome.
- No call has been made to a real Fastmail account or to the Claude API. `src/lib/jmap.ts` and `src/lib/claude.ts` are written from the published API docs and tested only against a fake `fetch`.
- The side panel and options UI have never been rendered. Expect layout and wiring bugs.

## Next task: milestone M1

Goal: one real reply drafted, threaded correctly, and sent by the owner from Fastmail. The owner has to be at the keyboard for this (their Chrome, their tokens). Work through these in order and record each answer in DESIGN.md under "Open questions".

1. `npm install`, `npm run build`, load `dist/` at `chrome://extensions`, open the options page. Fix whatever breaks.
2. **Fastmail URL format** (open question 1). Ask the owner for the URL shape of an open conversation in each view they use, with ids intact. `src/lib/fastmailUrl.ts` assumes a `T<hex>` thread id and `M<hex>` email id somewhere in the path or hash. Fix the regexes and the tests if that is wrong. The recent-conversations picker works regardless.
3. **Token scopes** (open question 2). Have the owner create a Fastmail API token with mail access and without sending, then use Test connection. Confirm `Email/set` can create a draft with that token.
4. **Draft visibility** (open question 3). After Save to Fastmail Drafts, check whether the draft appears in the open conversation without a reload, with the right From, To, Cc, subject, and quoted original.
5. Check the service-worker console and the panel console for errors during a full reply and a full compose.

Then continue with M2 in DESIGN.md.

## Commands

```sh
npm install        # run on the owner's machine; see the warning below
npm run check      # typecheck + tests + build; run before every commit
npm run dev        # vite build --watch, then reload the extension card in Chrome
npm test           # vitest
```

## Rules that must keep holding

- **Never send mail.** Do not add `urn:ietf:params:jmap:submission` to the JMAP `using` list and do not call `EmailSubmission/*` or `Identity/*`. A test asserts this. If a feature seems to need the submission scope (signatures, identity list), stop and ask the owner; DESIGN.md open questions 4 and 7 describe the trade-off.
- **Do not read mail content from the page.** Content comes from JMAP, the open conversation from the tab URL. The content script may add UI but must not depend on Fastmail's markup for anything the flow cannot do without. The floating button stays as the fallback when a toolbar button is added.
- **`src/content.ts` has no imports.** Content scripts load as classic scripts; a shared chunk breaks them. After a build, `dist/content.js` must contain no `import`.
- **Email text is untrusted.** Keep it inside the `<thread>` fence built in `src/lib/prompt.ts`, and keep stripping fence tags from it.
- **No secrets or personal data in the repo.** Tokens, keys, real addresses and real email text stay out of code, tests, fixtures and commit messages. Tests use `example.org` addresses.
- **Host permissions stay minimal:** `app.fastmail.com`, `api.fastmail.com`, `api.anthropic.com`. Adding one needs a reason in DESIGN.md.
- The owner reviews every draft. Do not add auto-send, auto-archive, or any action on mail beyond creating a draft.

## Things that will trip you up

- **Install dependencies on the machine that runs the build.** Vite 8 pulls platform-specific native binaries. This repo was scaffolded in a Linux container, so `node_modules` was deliberately not copied here. Do not run `npm install` from a Linux sandbox into a folder the owner then uses from macOS.
- **Vite 8 / TypeScript 6 / Vitest 5 / Vue 3.5** are the installed majors. `vite.config.ts` uses `import.meta.dirname`, not `__dirname`.
- **`chrome.sidePanel.open()` needs a user gesture.** `src/background.ts` calls it straight away in the message handler. Do not put an `await` before it.
- **Claude API from an extension page** needs the `anthropic-dangerous-direct-browser-access: true` header (already set). An API key from an organisation with zero data retention will be rejected with that header; the fix would be a small proxy, which DESIGN.md lists under alternatives.
- **Default model** is `claude-sonnet-5-5` in `src/lib/settings.ts`, editable in the options page. Check the current model list before changing it.
- **HTML-only emails** go through a crude `htmlToText` in `src/lib/jmap.ts`. Good enough as model input, not for display.
- **Only the token owner's primary JMAP account is used.** Mail in folders shared from another Fastmail user lives under a different account id (DESIGN.md open question 6).

## Map

```
public/manifest.json        MV3 manifest, copied to dist/ as is
sidepanel.html, options.html  Vite entry pages
src/background.ts           service worker: opens the panel, locks storage to extension pages
src/content.ts              floating "Draft with AI" button on app.fastmail.com
src/sidepanel/App.vue       the whole user flow and all network calls
src/options/Options.vue     settings: token, key, model, identities with voice notes
src/lib/jmap.ts             JMAP client: getThread, recentThreads, createDraft
src/lib/claude.ts           one Messages API call
src/lib/reply.ts            reply target, recipients, subject, threading headers, quoting (pure)
src/lib/prompt.ts           system prompt, fenced thread, compose output parsing (pure)
src/lib/fastmailUrl.ts      tab URL to thread/email id (assumption, see M1 step 2)
src/lib/settings.ts         chrome.storage.local wrapper
src/lib/types.ts            shared types
tests/lib.test.ts           unit tests for src/lib
```

## About the owner's setup

- Uses Fastmail's web app in Chrome on macOS, with several sending identities; one is a shared ministry address used with their spouse, who is the intended second user (M3).
- Wants a single unified place for mail and as few extra windows as possible, which is why this lives inside the Fastmail tab.
- Moved off Google and Missive deliberately. Do not add dependencies on Google services or on a hosted backend without asking.
- There is no git remote yet. Ask before creating or pushing to one.

# Fastmail Assist: design

A browser extension, for Chrome and Firefox, that brings the one Missive feature worth keeping to Fastmail's web app: say in a line what a reply should say, get a draft in your own voice, and have it land in Fastmail ready to review and send.

Status: v0.2.0. It builds for both browsers, typechecks, passes unit tests, and passes a browser test that loads the Chrome build into Chromium against a stand-in for Fastmail and the Claude API. It has not yet run against the real Fastmail web app, a real account or the real Claude API, and the Firefox build has not been loaded in Firefox; milestone 1 below is exactly that.

## Goals

- One click from an open conversation to a draft reply written from a short instruction, without leaving the Fastmail page.
- Compose a new email the same way.
- Drafts sound like the identity they are sent from (a shared family address reads differently from a personal one).
- The extension can never send mail. A person reviews and sends every message in Fastmail.
- Survive Fastmail UI changes with little or no maintenance.
- The same features in Chrome and Firefox.

## Non-goals

- Not a mail client. No inbox view, search or triage beyond a small "recent conversations" picker.
- No autonomous actions: no auto-reply, no sending, no archiving, no rules.
- No mobile. Chrome on iOS has no extensions; on the phone the Claude app with the Fastmail connector covers this.
- No server. Everything runs in the browser with the user's own keys.

## How it works for the user

In the Fastmail page:

1. Open a conversation. **Reply with AI** appears next to Fastmail's Reply button, and as a floating button bottom right. Either opens the composer, a small card in the corner of the page; so does Alt+Shift+D.
2. The composer shows who the reply goes to and the subject. Type the instruction ("yes to the 12th, ask if they can host"), choose the From identity if the suggested one is wrong, press **Draft**. The text streams in.
3. Edit it directly, or ask for a revision ("shorter", "in German").
4. Finish one of two ways:
   - **Insert into draft.** Click Reply in Fastmail (before or after drafting). The composer notices the open editor and offers Insert, which writes the text at the cursor. Fastmail keeps handling recipients, the quoted original and the signature. A ✦ button in the corner of any open draft editor opens the composer the same way.
   - **Save to Drafts.** With no draft open, the reply is saved to Fastmail Drafts over JMAP, threaded onto the conversation.
5. Review and send in Fastmail as usual.

With no conversation open, the composer writes a new email: body and a suggested subject, to insert into a new message or copy.

The side panel (Chrome) or sidebar (Firefox), Alt+Shift+R, has the same flow with more room: a picker of recent inbox conversations, and a new-email form with To and Subject that saves a complete draft. It keeps work in progress if it is closed and reopened.

## Architecture

```
 app.fastmail.com tab
┌─────────────────────────────┐  URL + instruction   ┌──────────────────────────────┐
│ content.ts                  ├─────────────────────►│ background.ts                │
│  launcher, toolbar button,  │   (runtime port)     │  lib/engine.ts               │
│  editor chip, composer card │◄─────────────────────┤   lib/jmap.ts ──► api.fastmail.com
│  writes the draft into the  │  subject, sender     │   lib/claude.ts ─► api.anthropic.com
│  open editor                │  name, draft text    │  opens the panel             │
└─────────────────────────────┘                      │  locks storage               │
                                                     └──────────────────────────────┘
 side panel / sidebar (Vue)           options page (Vue)
  App.vue: same flow, calls            keys, model, identities + voice notes,
  lib/engine.ts and lib/jmap.ts        connection tests, in-page toggles
  directly
```

| Part | File | Responsibility |
| --- | --- | --- |
| Content script | `src/content.ts` | All UI inside the Fastmail page, in a closed shadow root. Sends the page URL and the instruction to the background; writes the returned draft into the open editor. Holds no keys and reads no mail. |
| Background | `src/background.ts` | Answers the composer: looks up the conversation, drafts, revises, saves to Drafts. Opens the side panel inside the click's user gesture; restricts `storage.local` to extension pages. |
| Side panel | `src/sidepanel/App.vue` | The full workflow with recent conversations and new-email form. |
| Options page | `src/options/Options.vue` | Fastmail token, Claude key, model, identities with voice notes, connection tests, switches for the in-page extras. |
| Engine | `src/lib/engine.ts` | Builds the model request, streams the draft, splits subject from body. Shared by background and panel. |
| URL parser | `src/lib/fastmailUrl.ts` | Tab URL to thread and email id. |
| JMAP client | `src/lib/jmap.ts` | Session, read a thread, list recent threads, create a draft. |
| Reply logic | `src/lib/reply.ts` | Pick the message to answer, recipients, subject, threading headers, quoted original. Pure functions. |
| Prompt | `src/lib/prompt.ts` | System prompt per identity, fenced thread text, compose output parsing. Pure functions. |
| Claude client | `src/lib/claude.ts` | One streamed Messages API call. |
| Build | `scripts/build.mjs`, `scripts/manifest.mjs` | One build, two manifests: `dist/chrome` and `dist/firefox`. |

### How much the page is trusted, and how much it is touched

Fastmail's markup is not an API and changes without notice. JMAP is a published standard that Fastmail documents and supports for exactly this use. So mail content always comes from JMAP and the open conversation from the tab URL.

The in-page UI is layered so that each layer depends on less than the one above it, and everything still works when an upper layer fails:

| Layer | Depends on | If it breaks |
| --- | --- | --- |
| "Reply with AI" next to Reply | A visible button labelled Reply (or its translation) | Use the floating button. Can be switched off in settings. |
| ✦ chip and Insert into draft | The draft editor being a large editable element that accepts a paste event or `insertText` | Use Save to Drafts or Copy. |
| Floating button, composer, Save to Drafts | Nothing in Fastmail's markup; only the URL | Use the side panel's recent-conversations picker. |

Insert does not type into the editor key by key. It gives the editor a paste event carrying plain text, which is how a rich-text editor expects outside text to arrive (Fastmail's editor, Squire, turns it into one block per line). If the editor ignores the event, the browser's `insertText` command is used. The only thing read back is how much text the editor holds, to tell whether the insert worked.

### Keystrokes

Fastmail has single-letter keyboard shortcuts that act on mail. Text typed into the composer must never reach them. Events from inside the composer's shadow root surface to the page with the shadow host as their target, so the content script registers a capture-phase listener on `window` at `document_start`, before Fastmail's own scripts run, and stops key, input and clipboard events that come from its host. The composer's own shortcuts (Esc, Cmd/Ctrl+Enter, Enter to revise) are handled in that same listener.

### Data flow for a reply from the page

1. Content script sends the tab's URL to the background over a runtime port. With a draft editor open it also sends the URLs the tab showed in the last few minutes, because the address may then name the draft rather than the conversation.
2. Background extracts a thread or email id and makes one JMAP request with back-references: `Thread/get` then `Email/get` with text bodies, capped at 20 kB per message.
3. `pickReplyTarget` chooses the newest message not written by one of the configured identities; `pickIdentity` suggests the identity that message was addressed to. The subject, the sender's name and the message count go back to the page.
4. On Draft, the background calls the Claude Messages API with streaming: system prompt (rules plus that identity's voice notes), then one user turn containing the fenced conversation and the instruction. Partial text is forwarded to the page a few times a second.
5. Revisions resend the original request, the draft as currently edited on screen, and the change request.
6. Insert writes the text into the open editor. Save to Drafts has the background run `Email/set`, creating the draft in the Drafts mailbox with `$draft`, `inReplyTo` and `references` set, so Fastmail threads it.

The side panel does steps 2 to 6 itself, without the content script.

## Chrome and Firefox

One codebase. Differences are confined to the manifest and three run-time checks:

| | Chrome | Firefox |
| --- | --- | --- |
| Panel | `side_panel`, opened from the page via `chrome.sidePanel.open()` | `sidebar_action`; opened with the toolbar button or Alt+Shift+R. A click in the page cannot open it, so the composer hides that button. |
| Background | Service worker | Event page (`background.scripts`) |
| Storage lock | `storage.local.setAccessLevel('TRUSTED_CONTEXTS')` | Not available. The content script never reads storage, and page scripts cannot reach extension storage in either browser. |
| Site access | Granted at install | Can be declined at install; the settings page shows a Grant access button when it is missing. |
| Install | Load unpacked `dist/chrome` | Temporary add-on from `dist/firefox/manifest.json`, or sign the packaged zip as an unlisted add-on for a permanent install. Minimum Firefox 140. |

The Firefox manifest declares `data_collection_permissions: personalCommunications`, because the open conversation is sent to the Claude API. Mozilla requires this declaration for new add-ons.

## Security and privacy

- **Cannot send.** The client requests only the `core` and `mail` JMAP capabilities and never references `EmailSubmission` (unit tests assert this over all source files, and the browser test checks every request made). The Fastmail token should also be created without the sending scope, so this holds even if the code were wrong.
- **Email text is untrusted input.** It is fenced in `<thread>` tags, fence tags inside email text are stripped, and the system prompt says to treat it as material, not instructions. The realistic worst case of a hostile email is a strange draft that a person then reads before sending.
- **Keys** live in `chrome.storage.local`. They are sent only to `api.fastmail.com` and `api.anthropic.com`; those plus `app.fastmail.com` are the only host permissions. The content script never receives them: it can ask the background for a draft, not for settings.
- **What the page side sees.** The content script shares a process with the Fastmail page. It is given only what will be visible on that page anyway: the subject, the sender's name, the list of configured identities (name and address) and the draft. Its UI sits in a closed shadow root. The background accepts composer requests only from a content script of this extension running on `app.fastmail.com`.
- **What leaves the browser:** the text of the open conversation (last 12 messages, 6,000 characters each) and the instruction go to the Claude API under the user's own API account. The extension stores settings, and the side panel's work in progress in `storage.session` (memory only, cleared when the browser closes).
- **Third parties' mail.** Correspondents' emails are sent to the model. That is the same as using the Claude connector, but it is a decision to make knowingly for a ministry inbox.
- **Secrets stay out of the repository.** `scripts/scan-secrets.mjs` runs in `npm run check` and in a pre-push hook over every commit about to be pushed.

## Verified facts this rests on

- Fastmail JMAP: session at `https://api.fastmail.com/jmap/session`, `Authorization: Bearer <token>`, CORS enabled, capabilities `core`, `mail`, `submission` are separate scopes ([Fastmail developer docs](https://www.fastmail.com/dev/)).
- Claude API accepts browser-origin requests when `anthropic-dangerous-direct-browser-access: true` is set ([announcement write-up](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)). Organisations with zero data retention enabled reject that header.
- `chrome.sidePanel.open()` exists from Chrome 116 and may be called from a content-script click relayed to the service worker ([Chrome sidePanel reference](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)).
- Squire 2.4 (the open-source editor Fastmail's composer is built on) handles a synthetic paste event carrying `text/plain` and inserts one block per line. Checked in the browser test against the published `squire-rte` package; whether Fastmail's deployed editor is configured the same way is open question 8.

## Open questions (to settle in Milestone 1)

1. **URL format.** The parser assumes ids like `T…` and `M…` (hex) appear in the Fastmail URL. Check against real URLs in conversation view, reading-pane view, search results and with a draft open; adjust `fastmailUrl.ts`, the copy of the pattern in `content.ts`, and the tests.
2. **Token scopes in practice.** Confirm the token screen allows mail access without sending, and that such a token can create drafts.
3. **Draft visibility.** Confirm a JMAP-created draft shows up in the open conversation without a reload. If not, the "Open Drafts" link shown after saving is the way to it.
4. **Signatures.** Insert into draft sidesteps this: Fastmail's composer adds the signature itself. A draft saved over JMAP still has none. Options for that path: put the sign-off in the voice notes (current approach), or read signatures via `Identity/get`, which needs the submission scope and so weakens the cannot-send guarantee.
5. **Plain text vs HTML.** Same split: inserted text takes on the composer's formatting and Fastmail's own quoting. JMAP-saved drafts are plain text with a `>`-quoted original.
6. **Shared mailboxes.** Only the token owner's primary account is used. Folders shared from another Fastmail user sit under a different account id; needed if the Duo/Family layout is adopted.
7. **Identity list.** Identities are typed into settings by hand, for the same scope reason as question 4.
8. **The in-page pieces on the real page.** Unverified: that Fastmail's Reply control is a button whose label is "Reply"; that the toolbar tolerates an extra button beside it; that the draft editor is a large contenteditable (or textarea in plain-text mode) in the top document; that it accepts the paste; that Fastmail does not pull focus back from the composer; and that no Fastmail shortcut fires while typing in the composer. First findings in a Chromium browser on the real page: the draft editor fills its pane to the window corner, so the ✦ chip sat on top of the floating launcher; the chip now steps aside. A composer left open on its setup notice did not notice settings being saved; the background now pushes feature changes to open Fastmail tabs.
9. **Firefox.** Loading the add-on and the settings page work. The first Firefox-only bug: `storage.local.set` structured-clones its value there (Chrome serialises it as JSON), so a Vue reactive object made Save fail silently with `DataCloneError`; `saveSettings` now writes plain data and the page shows save errors. Still unverified: the sidebar, streaming from the event page, and the paste-based insert from a content script.

## Milestones

| | Scope | Done when |
| --- | --- | --- |
| **M0** | Scaffold: reply and compose to Drafts, floating button, settings, unit tests | Builds and tests pass (done) |
| **M1** | Load unpacked, run against the real account, settle open questions 1 to 3, 8 and 9 | A real reply drafted, threaded and sent from Fastmail |
| **M2** | Daily-use polish. Done in v0.2.0, pending M1: in-page composer, button beside Reply, insert into the open draft, streaming, panel keeps work in progress, redesigned panel and settings, Firefox build. Still open: the signature decision for JMAP-saved drafts | A week of use without falling back to the Claude app |
| **M3** | Second user: signed packages (unlisted Chrome Web Store item, unlisted Firefox add-on), shared voice notes, shared-mailbox account support | The second user works from the shared address |
| Later | Voice notes learned from Sent mail; recipient autocomplete from JMAP contacts; Safari extension for iOS | |

## Alternatives considered

- **Type into Fastmail's compose editor.** Rejected for v0 as too dependent on the editor's internals. Adopted in v0.2 in a narrower form: one paste event into whatever large editable element has focus, with Save to Drafts as the path that needs none of it.
- **Scrape the conversation from the page.** No token needed, but brittle and blind to collapsed messages. Rejected.
- **Small backend holding the keys.** Better key hygiene and works for zero-data-retention organisations, at the cost of running a service. Not needed for two users; revisit if the extension is ever shared more widely.
- **Use Claude in Chrome instead.** Works today with no build. Kept as the fallback; this extension exists for the one-click flow with remembered identities and voice.
- **Separate codebases per browser.** Not needed: the WebExtension APIs used are the same apart from the panel and the background type.

# Fastmail Assist: design

A Chrome extension that brings the one Missive feature worth keeping to Fastmail's web app: say in a line what a reply should say, get a draft in your own voice, and have it land in Fastmail ready to review and send.

Status: scaffold (v0.1.0). It builds, typechecks and passes unit tests. It has not yet been loaded in Chrome or run against a real Fastmail account; the first milestone below is exactly that.

## Goals

- One click from an open conversation to a draft reply written from a short instruction.
- Compose a new email the same way.
- Drafts sound like the identity they are sent from (joeandkelly@ reads differently from a personal address).
- The extension can never send mail. A person reviews and sends every message in Fastmail.
- Survive Fastmail UI changes with little or no maintenance.

## Non-goals

- Not a mail client. No inbox view, search or triage beyond a small "recent conversations" picker.
- No autonomous actions: no auto-reply, no sending, no archiving, no rules.
- No mobile. Chrome on iOS has no extensions; on the phone the Claude app with the Fastmail connector covers this.
- No server. Everything runs in the browser with the user's own keys.

## How it works for the user

1. Open a conversation in Fastmail and click **Draft with AI** (floating button, toolbar icon, or Alt+Shift+R). The side panel opens.
2. The panel shows which conversation it picked up and who the reply goes to. With no conversation open, it lists recent inbox conversations to choose from.
3. Type the instruction ("yes to the 12th, ask if they can host"), choose the From identity if the suggested one is wrong, press **Draft**.
4. Edit the text directly, or ask for a revision ("shorter", "in German").
5. Press **Save to Fastmail Drafts**. The draft is threaded onto the conversation; review and send it in Fastmail as usual.

New email is the same flow with a To field and a generated subject.

## Architecture

```
 app.fastmail.com tab                     Chrome side panel (Vue)
┌──────────────────────────┐            ┌─────────────────────────────────┐
│ content.ts               │  click     │ App.vue                         │
│  floating button only,   ├──────────► │  reads tab URL → thread id      │
│  never reads the page    │ background │  instruction, identity, draft   │
└──────────────────────────┘   opens    │                                 │
                               panel    │  lib/jmap.ts ──► api.fastmail.com
 background.ts                          │    read thread, save draft      │
  opens panel, locks storage            │  lib/claude.ts ─► api.anthropic.com
                                        │    draft and revise             │
 options page (Vue)                     └─────────────────────────────────┘
  keys, model, identities + voice notes
```

| Part | File | Responsibility |
| --- | --- | --- |
| Content script | `src/content.ts` | One button in a shadow root. Sends "open panel". Reads nothing from the page. |
| Service worker | `src/background.ts` | Opens the side panel inside the click's user gesture; restricts `storage.local` to extension pages. |
| Side panel | `src/sidepanel/App.vue` | The whole workflow and all network calls. |
| Options page | `src/options/Options.vue` | Fastmail token, Claude key, model, identities with voice notes, connection test. |
| URL parser | `src/lib/fastmailUrl.ts` | Tab URL to thread and email id. |
| JMAP client | `src/lib/jmap.ts` | Session, read a thread, list recent threads, create a draft. |
| Reply logic | `src/lib/reply.ts` | Pick the message to answer, recipients, subject, threading headers, quoted original. Pure functions. |
| Prompt | `src/lib/prompt.ts` | System prompt per identity, fenced thread text, compose output parsing. Pure functions. |
| Claude client | `src/lib/claude.ts` | One Messages API call. |

### Why the page is never scraped

Fastmail's markup is not an API and changes without notice. JMAP is a published standard that Fastmail documents and supports for exactly this use. So the mail content comes from JMAP, the open conversation comes from the tab URL, and the result goes back as a JMAP draft. The only thing touching the page is a button that needs no Fastmail markup at all. If the URL format ever changes, the recent-conversations picker still works.

### Data flow for a reply

1. Panel reads the active tab URL (allowed by the `app.fastmail.com` host permission) and extracts a thread or email id.
2. One JMAP request with back-references: `Thread/get` then `Email/get` with text bodies, capped at 20 kB per message.
3. `pickReplyTarget` chooses the newest message not written by one of the configured identities; `pickIdentity` suggests the identity that message was addressed to.
4. Claude Messages API call: system prompt (rules plus that identity's voice notes), then one user turn containing the fenced conversation and the instruction.
5. Revisions resend the original request, the draft as currently edited on screen, and the change request.
6. `Email/set` creates the draft in the Drafts mailbox with `$draft`, `inReplyTo` and `references` set, so Fastmail threads it.

## Security and privacy

- **Cannot send.** The client requests only the `core` and `mail` JMAP capabilities and never references `EmailSubmission` (a unit test asserts this). The Fastmail token should also be created without the sending scope, so this holds even if the code were wrong.
- **Email text is untrusted input.** It is fenced in `<thread>` tags, fence tags inside email text are stripped, and the system prompt says to treat it as material, not instructions. The realistic worst case of a hostile email is a strange draft that a person then reads before sending.
- **Keys** live in `chrome.storage.local`, restricted to extension pages. They are sent only to `api.fastmail.com` and `api.anthropic.com`; those plus `app.fastmail.com` are the only host permissions.
- **What leaves the browser:** the text of the open conversation (last 12 messages, 6,000 characters each) and the instruction go to the Claude API under the user's own API account. Nothing is stored by the extension besides settings; drafts in progress are lost when the panel closes.
- **Third parties' mail.** Correspondents' emails are sent to the model. That is the same as using the Claude connector, but it is a decision to make knowingly for a ministry inbox.

## Verified facts this rests on

- Fastmail JMAP: session at `https://api.fastmail.com/jmap/session`, `Authorization: Bearer <token>`, CORS enabled, capabilities `core`, `mail`, `submission` are separate scopes ([Fastmail developer docs](https://www.fastmail.com/dev/)).
- Claude API accepts browser-origin requests when `anthropic-dangerous-direct-browser-access: true` is set ([announcement write-up](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)). Organisations with zero data retention enabled reject that header.
- `chrome.sidePanel.open()` exists from Chrome 116 and may be called from a content-script click relayed to the service worker ([Chrome sidePanel reference](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)).

## Open questions (to settle in Milestone 1)

1. **URL format.** The parser assumes ids like `T…` and `M…` (hex) appear in the Fastmail URL. Check against real URLs in conversation view, reading-pane view and search results; adjust `fastmailUrl.ts` and its test.
2. **Token scopes in practice.** Confirm the token screen allows mail access without sending, and that such a token can create drafts.
3. **Draft visibility.** Confirm a JMAP-created draft shows up in the open conversation without a reload. If not, add a link that opens the draft.
4. **Signatures.** Fastmail's composer adds the identity's signature; a JMAP-created draft has none. Options: put the sign-off in the voice notes (current approach), or read signatures via `Identity/get`, which needs the submission scope and so weakens the cannot-send guarantee.
5. **Plain text vs HTML.** Drafts are plain text with a `>`-quoted original. Decide whether HTML drafts with Fastmail-style quoting are worth it.
6. **Shared mailboxes.** Only the token owner's primary account is used. Folders shared from another Fastmail user sit under a different account id; needed if the Duo/Family layout is adopted.
7. **Identity list.** Identities are typed into settings by hand, for the same scope reason as question 4.

## Milestones

| | Scope | Done when |
| --- | --- | --- |
| **M0** | This scaffold: reply and compose to Drafts, floating button, settings, unit tests | Builds and tests pass (done) |
| **M1** | Load unpacked, run against the real account, settle open questions 1 to 3 | A real reply drafted, threaded and sent from Fastmail |
| **M2** | Daily-use polish: button in Fastmail's own reply toolbar (the only markup-dependent piece, with the floating button as fallback), streaming output, keep draft across panel close, signature decision | A week of use without falling back to the Claude app |
| **M3** | Second user: packaging (unlisted Web Store or zipped build), shared voice notes, shared-mailbox account support | Kelly uses it on joeandkelly@ |
| Later | Voice notes learned from Sent mail; recipient autocomplete from JMAP contacts; Safari extension for iOS | |

## Alternatives considered

- **Type into Fastmail's compose editor.** Feels most "inline" but depends on the editor's internals and on simulating input. Rejected for v0; the draft-via-JMAP route gives the same result one click later.
- **Scrape the conversation from the page.** No token needed, but brittle and blind to collapsed messages. Rejected.
- **Small backend holding the keys.** Better key hygiene and works for zero-data-retention organisations, at the cost of running a service. Not needed for two users; revisit if the extension is ever shared more widely.
- **Use Claude in Chrome instead.** Works today with no build. Kept as the fallback; this extension exists for the one-click flow with remembered identities and voice.

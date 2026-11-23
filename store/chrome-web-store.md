# Chrome Web Store listing

Developer console: https://chrome.google.com/webstore/devconsole. Upload `fastmail-assist-chrome-<version>.zip` from the GitHub release. The store assigns its own extension ID.

## Store listing tab

**Name** (75 max)

    Fastmail Assist

**Summary** (132 max)

    Say in a line what an email should say and get a draft in your voice, inside Fastmail. Reads the whole thread. Never sends.

**Description**

    Fastmail Assist adds one thing to Fastmail's web app: say in a line what an email should say, and get a draft in your own voice that already knows the whole conversation and who you are writing to. The draft goes into the Fastmail draft you have open, or into your Drafts folder. You review and send it in Fastmail. The extension cannot send mail.

    HOW IT WORKS
    • "Reply with AI" sits next to Fastmail's own Reply button and as a floating button. It opens a small composer inside the page.
    • Type the instruction ("yes to the 12th, ask if they can host"), press Draft, and the reply streams in.
    • It reads the whole conversation, not just the last message, so it answers what was asked and does not repeat what has been agreed.
    • It looks up recent earlier conversations with the recipient and uses them as background, so greetings use the right name and the draft fits the relationship. This can be turned off.
    • New emails get a To field that suggests people from your Fastmail contacts and recent correspondence as you type. The model proposes a subject.
    • Each sending identity has its own voice notes; the identity the conversation was addressed to is picked for you.
    • Edit the text, or ask for a revision: shorter, warmer, in German.
    • Finish in Fastmail: insert into the open draft (Fastmail keeps handling recipients, the quote and your signature), or Save to Drafts, threaded onto the conversation.
    • A side panel offers the same flow with a list of recent conversations.

    YOUR KEYS, YOUR BROWSER, NO SERVER
    • You bring your own Fastmail API token (mail access, no sending) and your own Claude API key from Anthropic. The extension talks only to api.fastmail.com and api.anthropic.com.
    • Keys stay in your browser profile. There is no server of ours, no account, no analytics.
    • It never sends email: it asks Fastmail only for the capabilities needed to read mail and save drafts, never the one that sends. Create the token without the "Email submission" scope and this holds no matter what.
    • What goes to the Claude API: the open conversation, the earlier conversations with the recipient if that setting is on, and your instruction, under your own API account.

    REQUIREMENTS
    • A Fastmail account with API tokens (not available on Fastmail's Basic plan).
    • An Anthropic API key (console.anthropic.com).

    Open source under the MIT license: https://github.com/jarofclay/fastmail-assist. Fastmail Assist is an independent project, not affiliated with Fastmail or Anthropic.

**Category:** Productivity → Workflow & Planning
**Language:** English
**Icon:** 128×128, in the zip (`icons/icon-128.png`).
**Screenshots** (1280×800): the five files in `screenshots/`, in number order.
**Small promo tile** (440×280): `screenshots/promo-small-440x280.png`.
**Homepage URL:** https://github.com/jarofclay/fastmail-assist
**Support URL:** https://github.com/jarofclay/fastmail-assist/issues

## Privacy practices tab

**Single purpose description**

    Draft email replies and new emails inside Fastmail's web app from a one-line instruction, for the user to review and send themselves.

**Permission justifications**

- `sidePanel`: Shows the extension's side panel (the drafting flow with a list of recent conversations) on Fastmail tabs only.
- `storage`: Stores the user's own settings in the browser: their Fastmail API token, their Claude API key, the model name, sending identities with voice notes, and feature switches. Nothing is stored anywhere else.
- Host `https://app.fastmail.com/*`: Runs the content script that adds the "Reply with AI" button and the composer to Fastmail's web app, and reads the tab URL to know which conversation is open. It does not read message content from the page.
- Host `https://api.fastmail.com/*`: Fastmail's JMAP API, with the user's own token: reads the open conversation, recent earlier mail with the recipient and address-book matches for the To field, and saves drafts. It never sends mail (the submission capability is never requested).
- Host `https://api.anthropic.com/*`: Anthropic's Claude API, with the user's own key: receives the conversation and the instruction and returns the draft.

**Remote code:** No, I am not using remote code.

**Data usage** (tick these):
- Personally identifiable information: names and email addresses of correspondents, read from message headers and the user's contacts, shown in the composer and sent to the Claude API as part of the draft request.
- Authentication information: the user's Fastmail API token and Claude API key, stored locally and sent only to the service each belongs to.
- Personal communications: the user's email messages, read from Fastmail to draft a reply and sent to the Claude API for that purpose.

Do not tick: health, financial, location, web history, user activity, website content.

**Certifications** (all three can be ticked truthfully):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

    https://github.com/jarofclay/fastmail-assist/blob/main/PRIVACY.md

## Distribution tab

Visibility: **Unlisted** to start (anyone with the link can install; not searchable). Public later. Regions: all.

## Notes for the reviewer (in "Additional information" if asked)

    The extension needs the reviewer's own Fastmail API token and Anthropic API key; it has no accounts of its own and we cannot provide test credentials for third-party services. All network traffic goes to api.fastmail.com and api.anthropic.com with those user-supplied credentials. The code is open source; an end-to-end test against a stand-in server is in the repository (`npm run e2e`).

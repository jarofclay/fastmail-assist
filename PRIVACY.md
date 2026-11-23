# Privacy policy for Fastmail Assist

Version 1, 23 November 2026. Applies to Fastmail Assist 0.4.0 and later.

Fastmail Assist is a browser extension that drafts email replies and new emails inside Fastmail's web app from a one-line instruction, for you to review and send yourself. It is open source (https://github.com/jarofclay/fastmail-assist) and published under the MIT license. This policy says what data it handles, where that data goes, and what it never does.

## The short version

- Everything runs in your browser. There is no server of ours, no account with us, no analytics, no telemetry, no advertising, and nothing is sold or shared.
- The extension talks to exactly two services, both chosen and paid for by you: **Fastmail** (over its JMAP API, with an API token you create) and **Anthropic's Claude API** (with an API key you create). Nothing goes anywhere else.
- It can read your mail in order to draft, but it **cannot send mail**. It only saves drafts to your Fastmail Drafts folder or writes text into a draft you have open. You send.

## What the extension stores

In your browser profile's extension storage, on your device only:

- Your Fastmail API token and your Claude API key, as you typed them in the settings.
- Your settings: the model name, your sending identities (name, address, free-text notes on how you write), and feature switches.
- Work in progress in the side panel (the conversation you were on, your instruction and the draft), in session storage that is cleared when the browser closes.

These stay until you change them, remove the extension, or clear the browser's extension data. The extension never copies them anywhere.

## What the extension reads, and where it goes

**From Fastmail, with your token, over the JMAP API (api.fastmail.com):**

- The conversation you have open: its messages (text, up to a size limit), senders, recipients, subjects and dates.
- When the "earlier conversations" setting is on (it is on by default), the most recent earlier conversations with the person you are writing to: the latest message of up to six of them.
- When you type in the To field: matching names and addresses from your Fastmail contacts (only if the token has the Contacts scope) and from people you have recently written to or heard from.
- Your mailbox list, to find Inbox and Drafts.

**To Anthropic's Claude API, with your key (api.anthropic.com):**

- The text of the conversation, the earlier conversations described above (if the setting is on), the names and addresses involved, your instruction, your sending identity's name and address, and your voice notes. This is what the model needs to write the draft. Anthropic's handling of that data is governed by Anthropic's own terms and privacy policy for API use, which you accept when you create the key. If you do not want earlier conversations sent, turn the setting off; then only the open conversation and your instruction go.

**Written back to Fastmail:** the draft you choose to save, into your Drafts folder, or the text inserted into the draft you have open.

**Read from the Fastmail web page itself:** only the page address (to know which conversation is open), the labels of buttons (to find Fastmail's Reply button), element sizes, and the amount of text in a draft editor (to confirm an insert worked). The extension does not read message content from the page; content comes from the JMAP API.

## What it never does

- It never sends email. It requests only the JMAP `core`, `mail` and, if your token allows it, `contacts` capabilities, and never the `submission` capability that sending needs. We recommend creating the token without the "Email submission" scope, so this holds even if the software had a bug.
- It never contacts any server other than api.fastmail.com and api.anthropic.com (and app.fastmail.com, which is the page it runs on). The extension's permissions are limited to these three hosts.
- It never sells, shares, rents or transfers your data to anyone, and never uses it for anything but drafting the email you asked for.
- It never runs remote code, loads scripts from the network, or updates itself outside the browser's normal extension update.

## Third parties' mail

The messages of the people you correspond with are part of what is sent to the Claude API when you ask for a draft. That is the same as with any AI assistant connected to a mailbox, but it is your decision to make knowingly, especially for a shared or organisational inbox.

## Children

Fastmail Assist is not directed at children and does not knowingly collect anything from anyone; it collects nothing at all.

## Changes

Changes to this policy are made in the repository and listed in its changelog, with the version number above updated.

## Contact

Open an issue at https://github.com/jarofclay/fastmail-assist/issues.

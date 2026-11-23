# Firefox Add-ons (AMO) listing

Developer hub: https://addons.mozilla.org/developers/. Upload `fastmail-assist-firefox-<version>.zip` from the GitHub release.

## Channel

- **On your own** (unlisted): AMO signs the file after automated review, usually within minutes; you install the signed `.xpi` from a file and share it. Updates need a `gecko.update_url` in the manifest pointing at a hosted `updates.json`; not set up yet.
- **On this site** (listed): public, searchable, human-reviewed. Use this once the extension has been used for a while.

The manifest already carries what AMO requires of new submissions: a fixed add-on id, `strict_min_version`, and the data-collection declaration (`personalCommunications`).

## Source code (required)

The build is bundled by Vite, so AMO asks for the source alongside the package. Upload `fastmail-assist-source-<version>.zip` from the same GitHub release (a `git archive` of the tagged commit) and paste these build instructions:

    Node 22 (as in .github/workflows), npm 10.
    npm ci
    npm run build
    The Firefox package is the contents of dist/firefox. The build is deterministic for a given package-lock.json.

## Listing fields

**Name** (50 max)

    Fastmail Assist

**Add-on URL**

    fastmail-assist

**Summary** (250 max)

    Draft replies and new emails inside Fastmail from a one-line instruction. The draft knows the whole conversation and who you are writing to, sounds like you, and lands in your Fastmail draft or Drafts folder. You review and send. It cannot send mail.

**Description**: the same text as the Chrome Web Store description in `chrome-web-store.md` (AMO allows a little markup: `<b>`, `<ul>`, `<li>`, `<a>`).

**Categories** (up to two): Social & Communication; Other.
**Support email:** one you are happy to publish. **Support website:** https://github.com/jarofclay/fastmail-assist/issues
**Homepage:** https://github.com/jarofclay/fastmail-assist
**License:** MIT License.
**Privacy policy:** paste the text of `PRIVACY.md`, and give the URL https://github.com/jarofclay/fastmail-assist/blob/main/PRIVACY.md.
**Icon:** `public/icons/icon-128.png` (AMO also takes the SVG at `public/icons/icon.svg`).
**Screenshots:** the five files in `screenshots/`.
**Version notes:** the matching section of `CHANGELOG.md`.

## Notes to reviewer

    Fastmail Assist drafts email replies inside Fastmail's web app with the user's own Fastmail API token and Anthropic API key. It has no accounts or servers of its own, so we cannot supply test credentials for those third-party services; a reviewer with a Fastmail account (API tokens are not available on the Basic plan) and an Anthropic key can exercise it fully.

    Network: only api.fastmail.com (JMAP) and api.anthropic.com, both with the user's credentials, plus the content script on app.fastmail.com. No remote code is loaded.

    The extension cannot send mail: it never requests the JMAP submission capability; unit and browser tests in the repository assert this over every source file and every request made.

    Data collection: the open conversation and, if the user leaves the setting on, recent earlier conversations with the recipient are sent to the Claude API to write the draft; declared as personalCommunications in the manifest and described in PRIVACY.md.

    An end-to-end test against a stand-in for Fastmail and the Claude API is included: `npm run e2e` (needs Playwright with Chromium).

    Validator warnings: the sidePanel.* calls are Chrome-only and run only when chrome.sidePanel exists (Firefox uses sidebar_action instead); the innerHTML assignment is inside the Vue 3 runtime, not application code.

## Permissions AMO will show to users

- Access your data for app.fastmail.com
- Access your data for api.fastmail.com and api.anthropic.com
- Data collection: personal communications (declared as required)

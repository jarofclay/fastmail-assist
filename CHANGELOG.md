# Changelog

Notable changes to Fastmail Assist. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). While the version is 0.x, settings and behaviour may still change between minor versions.

Releases are published from tags: see "Releasing" in the README.

## [Unreleased]

## [0.3.0] - 2026-11-23

### Added

- **Replies read the whole conversation.** Every message in the thread goes to the model, newest in full and older ones shortened, with the quoted repeats at the end of each message stripped out. The prompt names everyone in the conversation and tells the model to address the recipient the way they sign their messages, so greetings use the right name.
- **Earlier conversations as background.** Before drafting, the extension looks up recent earlier conversations with the person being written to (the latest message of up to six, apart from the one open) and gives them to the model as background. The composer and side panel say how many were found. A new setting, on by default, turns this off.
- **To field for new emails, with autocomplete.** The in-page composer has a To field; the side panel's To field now suggests people as you type. Suggestions come from Fastmail Contacts when the API token has the "Contacts and contact groups" scope, and from people recently written to or heard from in any case. Any address can still be typed in.
- **Save a complete new email to Drafts from the page.** With a To address, the in-page composer saves a new email with To, an editable Subject and the body to Fastmail Drafts, like the side panel already did.
- **Releases.** A CI workflow runs the checks and the browser test on every pull request; pushing a `v*` tag builds, packages and publishes a GitHub release with the Chrome and Firefox zips attached. `npm run release` tags a release locally after the same checks.
- README rewritten with screenshots, a privacy section and install steps from a release.
- MIT license.

### Fixed

- In Chrome, the side panel followed you into every tab of the window, including new ones. It is now a tab-specific panel enabled only on Fastmail tabs; the toolbar icon or Alt+Shift+R on another tab brings a Fastmail tab to the front instead.

### Changed

- The icon is now Fastmail's reply arrow with a sparkle, in the toolbar, the in-page buttons, the panel and the settings page.
- Test connection in the settings reports whether the token can read contacts.
- The background worker keeps one JMAP session per token instead of fetching the session for every request.

### Privacy

- With the new setting on, the earlier conversations described above are sent to the Claude API along with the open conversation. With it off, only the open conversation is sent, as before.
- The content script now also receives address-book matches (names and addresses only) and the count of earlier conversations. It still never receives keys or message bodies.

## [0.2.0] - 2026-11-23

### Added

- In-page composer inside the Fastmail tab, opened from a "Reply with AI" button next to Fastmail's Reply, a floating button, a chip in the corner of an open draft editor, or Alt+Shift+D.
- Insert into the open draft (a paste event into Fastmail's editor), with Save to Drafts and Copy as fallbacks.
- Streaming drafts and revisions.
- Firefox build (sidebar, event page), produced from the same code by `scripts/manifest.mjs`.
- Side panel keeps work in progress when closed and reopened.
- Pre-push secret scan (`scripts/scan-secrets.mjs`) and `npm run check`.
- Browser smoke test against a stand-in for Fastmail and the Claude API.

### Fixed

- Settings could not be saved in Firefox (`DataCloneError` on a reactive object).
- The editor chip no longer sits on top of the floating launcher.
- A composer left open on its setup notice now notices saved settings.

## [0.1.0] - 2026-11-17

### Added

- First scaffold: side-panel reply and new email, saved to Fastmail Drafts over JMAP; settings for the Fastmail token, Claude key, model and identities with voice notes; unit tests.

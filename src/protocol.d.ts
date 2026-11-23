/**
 * Messages between the content script and the background worker.
 *
 * Declared as ambient types because src/content.ts must stay free of imports.
 * The content script never receives keys or raw mail: it sends the page URL,
 * the instruction and what was typed into the To field, and gets back the
 * conversation's subject line, the sender's name, address-book matches (names
 * and addresses only), a count of earlier conversations, and the draft.
 */
declare namespace FA {
  /** One-shot messages (chrome.runtime.sendMessage). */
  type OneShot =
    | { type: 'fa:open-panel' }
    | { type: 'fa:open-settings' }
    | { type: 'fa:hello' };

  /** Sent by the background to a tab (chrome.tabs.sendMessage). */
  type ToTab = { type: 'fa:toggle-composer' } | { type: 'fa:features'; features: Features };

  interface Features {
    configured: boolean;
    toolbarButton: boolean;
    editorChip: boolean;
    /** False where the browser cannot open the side panel from a page click (Firefox). */
    canOpenPanel: boolean;
  }

  /** Identifies a conversation; produced by the background from a page URL. */
  interface Ref {
    threadId?: string;
    emailId?: string;
  }

  interface Conversation {
    ref: Ref;
    subject: string;
    replyTo: string;
    messageCount: number;
    suggestedIdentity: string;
  }

  /** Someone to write to, from the address book or recent mail. */
  interface Person {
    name: string;
    email: string;
  }

  /** Port messages, content script to background. `id` pairs a request with its replies. */
  type Request =
    | { type: 'context'; id: number; urls: string[] }
    | {
        type: 'generate';
        id: number;
        ref: Ref | null;
        /** New email: the To field as typed. */
        to?: string;
        instruction: string;
        identityEmail: string;
        current?: string;
        revision?: string;
      }
    | { type: 'cancel'; id: number }
    | { type: 'save'; id: number; ref: Ref; identityEmail: string; replyAll: boolean; body: string; pageUrl: string }
    | { type: 'save-new'; id: number; identityEmail: string; to: string; subject: string; body: string; pageUrl: string }
    /** Who matches what was typed into the To field so far. */
    | { type: 'people'; id: number; query: string }
    /** New email: how much earlier mail there is with the people in the To field. */
    | { type: 'history'; id: number; to: string };

  /** Port messages, background to content script. */
  type Reply =
    | {
        type: 'context';
        id: number;
        features: Features;
        identities: { email: string; name: string }[];
        conversation: Conversation | null;
        error?: string;
      }
    /**
     * Earlier conversations found with the recipient. Follows a `context`
     * reply (same id) for a reply, or answers a `history` request.
     */
    | { type: 'history'; id: number; count: number; with: string }
    | { type: 'people'; id: number; people: Person[] }
    | { type: 'progress'; id: number; body: string; subject: string }
    | { type: 'done'; id: number; body: string; subject: string; truncated: boolean }
    | { type: 'saved'; id: number; draftsUrl: string }
    | { type: 'error'; id: number; message: string };
}

/** Set at build time: true only in the end-to-end test build, so tests can reach the UI. */
declare const __FA_OPEN_SHADOW__: boolean;

export interface Address {
  name?: string | null;
  email: string;
}

/** The subset of a JMAP Email (RFC 8621) this extension reads. */
export interface Email {
  id: string;
  threadId: string;
  from: Address[] | null;
  to: Address[] | null;
  cc: Address[] | null;
  replyTo: Address[] | null;
  subject: string | null;
  receivedAt: string;
  messageId: string[] | null;
  references: string[] | null;
  keywords: Record<string, boolean>;
  /** Plain-text body, already extracted from textBody/bodyValues. */
  text: string;
  /** True when the server cut the body at maxBodyValueBytes. */
  truncated: boolean;
}

export interface Thread {
  id: string;
  /** Oldest first, drafts excluded. */
  emails: Email[];
}

export interface ThreadSummary {
  threadId: string;
  emailId: string;
  subject: string;
  from: string;
  receivedAt: string;
  preview: string;
}

/** A sending identity and the voice to write in when using it. */
export interface Identity {
  email: string;
  name: string;
  /** Free-text style notes, e.g. "Warm, first names, sign off 'Joe & Kelly'". */
  voice: string;
}

/** Which pieces of UI the content script adds to the Fastmail page. */
export interface InPageSettings {
  /** "Reply with AI" next to Fastmail's own Reply button. Depends on Fastmail's markup. */
  toolbarButton: boolean;
  /** The chip shown in the corner of an open draft editor. */
  editorChip: boolean;
}

export interface Settings {
  fastmailToken: string;
  anthropicKey: string;
  model: string;
  identities: Identity[];
  inPage: InPageSettings;
}

/** What gets written to the Drafts mailbox. */
export interface DraftInput {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  body: string;
  inReplyTo?: string[];
  references?: string[];
}

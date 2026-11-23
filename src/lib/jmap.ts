import type { Address, DraftInput, Email, Person, Thread, ThreadSummary } from './types';

const SESSION_URL = 'https://api.fastmail.com/jmap/session';
const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';
/** JMAP for Contacts (RFC 9610). Only present when the token has the Contacts scope. */
const CONTACTS = 'urn:ietf:params:jmap:contacts';

/** Bodies longer than this are cut by the server; plenty for drafting a reply. */
const MAX_BODY_BYTES = 20_000;
/** Earlier conversations are background, so a shorter cut of each is enough. */
const HISTORY_BODY_BYTES = 4_000;

const EMAIL_PROPERTIES = [
  'id', 'threadId', 'from', 'to', 'cc', 'replyTo', 'subject', 'receivedAt',
  'messageId', 'references', 'keywords', 'textBody', 'bodyValues',
];

type MailboxRole = 'inbox' | 'drafts' | 'trash' | 'junk';

type MethodCall = [name: string, args: Record<string, unknown>, callId: string];
type MethodResponse = [name: string, result: Record<string, unknown>, callId: string];

interface Session {
  apiUrl: string;
  accountId: string;
  /** Account to query for contacts, when the token can read them. */
  contactsAccountId?: string;
}

interface Mailbox {
  id: string;
  role: string | null;
}

interface RawEmail {
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
  preview?: string;
  textBody?: { partId: string; type: string }[];
  bodyValues?: Record<string, { value: string; isTruncated: boolean }>;
}

/**
 * A contact as the server returns it. The expected shape is a JSContact Card
 * (RFC 9553): `name.components` or `name.full`, and `emails` as a map of
 * objects with `address`. The older shape with `firstName`, `lastName` and an
 * `emails` array of `{ value }` is accepted as well.
 */
export interface RawCard {
  id?: string;
  name?: string | { full?: string; components?: { kind?: string; value?: string }[] } | null;
  emails?: Record<string, { address?: string; pref?: number }> | { value?: string }[] | null;
  firstName?: string;
  lastName?: string;
}

const VALID_ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export class JmapError extends Error {
  /** `fatal` marks problems with the token or the connection, as opposed to one missing item. */
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
  }
}

/**
 * Minimal JMAP client. Uses only the core, mail and (when the token allows)
 * contacts capabilities, so a token without the submission scope is enough:
 * this code cannot send mail.
 */
export class JmapClient {
  private session?: Session;
  private mailboxes?: Mailbox[];
  /** Set once a contacts request failed, so later searches skip it quietly. */
  private contactsUnavailable = false;

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchFn(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    if (response.status === 401) throw new JmapError('Fastmail rejected the API token.', true);
    if (!response.ok) throw new JmapError(`Fastmail returned HTTP ${response.status}.`, true);
    return response.json();
  }

  private async getSession(): Promise<Session> {
    if (this.session) return this.session;
    const raw = (await this.request(SESSION_URL)) as {
      apiUrl: string;
      primaryAccounts: Record<string, string>;
    };
    const accountId = raw.primaryAccounts[MAIL];
    if (!accountId) throw new JmapError('This API token has no mail access.', true);
    this.session = { apiUrl: raw.apiUrl, accountId, contactsAccountId: raw.primaryAccounts[CONTACTS] };
    return this.session;
  }

  /** What this token can do, for the settings page. */
  async capabilities(): Promise<{ contacts: boolean }> {
    const session = await this.getSession();
    return { contacts: Boolean(session.contactsAccountId) };
  }

  private async call(build: (session: Session) => MethodCall[], using: string[] = [CORE, MAIL]): Promise<MethodResponse[]> {
    const session = await this.getSession();
    const raw = (await this.request(session.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ using, methodCalls: build(session) }),
    })) as { methodResponses: MethodResponse[] };
    for (const [name, result] of raw.methodResponses) {
      if (name === 'error') {
        throw new JmapError(`Fastmail API error: ${String(result.type)} ${String(result.description ?? '')}`.trim());
      }
    }
    return raw.methodResponses;
  }

  private async getMailboxes(): Promise<Mailbox[]> {
    if (!this.mailboxes) {
      const [response] = await this.call(({ accountId }) => [
        ['Mailbox/get', { accountId, ids: null, properties: ['id', 'role'] }, 'm'],
      ]);
      this.mailboxes = (response?.[1].list as Mailbox[] | undefined) ?? [];
    }
    return this.mailboxes;
  }

  private async getMailboxId(role: MailboxRole): Promise<string> {
    const mailbox = (await this.getMailboxes()).find((m) => m.role === role);
    if (!mailbox) throw new JmapError(`No ${role} mailbox found.`);
    return mailbox.id;
  }

  /** Load a whole conversation, given either its thread id or any email in it. */
  async getThread(ref: { threadId?: string; emailId?: string }): Promise<Thread> {
    if (!ref.threadId && !ref.emailId) throw new JmapError('No conversation selected.');
    const responses = await this.call(({ accountId }) => {
      const calls: MethodCall[] = [];
      let threadIds: Record<string, unknown>;
      if (ref.threadId) {
        threadIds = { ids: [ref.threadId] };
      } else {
        calls.push(['Email/get', { accountId, ids: [ref.emailId], properties: ['threadId'] }, 'e']);
        threadIds = { '#ids': { resultOf: 'e', name: 'Email/get', path: '/list/*/threadId' } };
      }
      calls.push(['Thread/get', { accountId, ...threadIds }, 't']);
      calls.push([
        'Email/get',
        {
          accountId,
          '#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' },
          properties: EMAIL_PROPERTIES,
          fetchTextBodyValues: true,
          maxBodyValueBytes: MAX_BODY_BYTES,
        },
        'emails',
      ]);
      return calls;
    });
    const emailsResponse = responses.find(([, , callId]) => callId === 'emails');
    const raw = (emailsResponse?.[1].list as RawEmail[] | undefined) ?? [];
    const emails = raw
      .filter((e) => !e.keywords['$draft'])
      .map(toEmail)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const first = emails[0];
    if (!first) throw new JmapError('That conversation could not be found.');
    return { id: first.threadId, emails };
  }

  /** Newest inbox conversations, for the picker shown when no thread is open. */
  async recentThreads(limit = 15): Promise<ThreadSummary[]> {
    const inboxId = await this.getMailboxId('inbox');
    const responses = await this.call(({ accountId }) => [
      [
        'Email/query',
        {
          accountId,
          filter: { inMailbox: inboxId },
          sort: [{ property: 'receivedAt', isAscending: false }],
          collapseThreads: true,
          limit,
        },
        'q',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
          properties: ['id', 'threadId', 'from', 'subject', 'receivedAt', 'preview'],
        },
        'g',
      ],
    ]);
    const raw = (responses.find(([, , callId]) => callId === 'g')?.[1].list as RawEmail[] | undefined) ?? [];
    return raw.map((e) => ({
      threadId: e.threadId,
      emailId: e.id,
      subject: e.subject ?? '(no subject)',
      from: displayName(e.from?.[0]),
      receivedAt: e.receivedAt,
      preview: e.preview ?? '',
    }));
  }

  /**
   * Recent mail exchanged with these addresses: the newest message of each
   * conversation, newest first, leaving out drafts, trash and spam, and the
   * conversation given in `excludeThreadId` (the one being answered).
   */
  async correspondence(
    addresses: string[],
    options: { excludeThreadId?: string; limit?: number } = {},
  ): Promise<Email[]> {
    const clean = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => VALID_ADDRESS.test(a)))].slice(0, 3);
    if (clean.length === 0) return [];
    const limit = options.limit ?? 6;
    const hidden = (await this.getMailboxes()).filter((m) => m.role === 'trash' || m.role === 'junk' || m.role === 'drafts').map((m) => m.id);
    const responses = await this.call(({ accountId }) => [
      [
        'Email/query',
        {
          accountId,
          filter: {
            operator: 'AND',
            conditions: [
              { operator: 'OR', conditions: clean.flatMap((a) => [{ from: a }, { to: a }, { cc: a }]) },
              { notKeyword: '$draft' },
              ...(hidden.length > 0 ? [{ inMailboxOtherThan: hidden }] : []),
            ],
          },
          sort: [{ property: 'receivedAt', isAscending: false }],
          collapseThreads: true,
          limit: limit + (options.excludeThreadId ? 1 : 0),
        },
        'q',
      ],
      [
        'Email/get',
        {
          accountId,
          '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
          properties: EMAIL_PROPERTIES,
          fetchTextBodyValues: true,
          maxBodyValueBytes: HISTORY_BODY_BYTES,
        },
        'h',
      ],
    ]);
    const raw = (responses.find(([, , callId]) => callId === 'h')?.[1].list as RawEmail[] | undefined) ?? [];
    return raw
      .filter((e) => !e.keywords['$draft'] && e.threadId !== options.excludeThreadId)
      .map(toEmail)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }

  /**
   * People matching what was typed into a To field: address-book entries
   * first (when the token can read contacts), then people recently written
   * to or heard from. Addresses in `exclude` (our own) are left out.
   */
  async searchPeople(query: string, options: { exclude?: string[]; limit?: number } = {}): Promise<Person[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const limit = options.limit ?? 8;
    const exclude = new Set((options.exclude ?? []).map((a) => a.trim().toLowerCase()));
    const [contacts, recent] = await Promise.all([this.searchContacts(q, limit), this.recentCorrespondents(q, limit)]);
    const seen = new Set<string>();
    const people: Person[] = [];
    for (const person of [...contacts, ...recent]) {
      const key = person.email.toLowerCase();
      if (seen.has(key) || exclude.has(key)) continue;
      seen.add(key);
      people.push(person);
    }
    return people.slice(0, limit);
  }

  private async searchContacts(query: string, limit: number): Promise<Person[]> {
    const session = await this.getSession();
    const accountId = session.contactsAccountId;
    if (!accountId || this.contactsUnavailable) return [];
    try {
      const responses = await this.call(
        () => [
          ['ContactCard/query', { accountId, filter: { text: query }, limit }, 'cq'],
          [
            'ContactCard/get',
            { accountId, '#ids': { resultOf: 'cq', name: 'ContactCard/query', path: '/ids' }, properties: ['id', 'name', 'emails'] },
            'cg',
          ],
        ],
        [CORE, CONTACTS],
      );
      const cards = (responses.find(([, , callId]) => callId === 'cg')?.[1].list as RawCard[] | undefined) ?? [];
      return cards.flatMap(cardPeople);
    } catch (error) {
      // A token without the Contacts scope, or a server without this API:
      // carry on with recent correspondents only.
      if (error instanceof JmapError && error.fatal) throw error;
      this.contactsUnavailable = true;
      return [];
    }
  }

  private async recentCorrespondents(query: string, limit: number): Promise<Person[]> {
    const responses = await this.call(({ accountId }) => [
      [
        'Email/query',
        {
          accountId,
          filter: { operator: 'OR', conditions: [{ from: query }, { to: query }, { cc: query }] },
          sort: [{ property: 'receivedAt', isAscending: false }],
          collapseThreads: true,
          limit: Math.max(limit * 2, 12),
        },
        'q',
      ],
      ['Email/get', { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['id', 'from', 'to', 'cc'] }, 'g'],
    ]);
    const raw = (responses.find(([, , callId]) => callId === 'g')?.[1].list as RawEmail[] | undefined) ?? [];
    const needle = query.toLowerCase();
    const people: Person[] = [];
    for (const email of raw) {
      for (const address of [...(email.from ?? []), ...(email.to ?? []), ...(email.cc ?? [])]) {
        const name = address.name?.trim() ?? '';
        if (!VALID_ADDRESS.test(address.email)) continue;
        if (!name.toLowerCase().includes(needle) && !address.email.toLowerCase().includes(needle)) continue;
        people.push({ name, email: address.email });
      }
    }
    return people;
  }

  /** Save a draft. Returns the new email id. Nothing is sent. */
  async createDraft(draft: DraftInput): Promise<string> {
    const draftsId = await this.getMailboxId('drafts');
    const [response] = await this.call(({ accountId }) => [
      [
        'Email/set',
        {
          accountId,
          create: {
            draft: {
              mailboxIds: { [draftsId]: true },
              keywords: { $draft: true, $seen: true },
              from: [draft.from],
              to: draft.to,
              cc: draft.cc.length > 0 ? draft.cc : null,
              subject: draft.subject,
              inReplyTo: draft.inReplyTo ?? null,
              references: draft.references ?? null,
              bodyValues: { body: { value: draft.body } },
              textBody: [{ partId: 'body', type: 'text/plain' }],
            },
          },
        },
        's',
      ],
    ]);
    const result = response?.[1] ?? {};
    const created = (result.created as Record<string, { id: string }> | null | undefined)?.draft;
    if (!created) {
      const reason = (result.notCreated as Record<string, { type: string; description?: string }> | undefined)?.draft;
      throw new JmapError(`Fastmail would not save the draft: ${reason?.description ?? reason?.type ?? 'unknown reason'}.`);
    }
    return created.id;
  }
}

export function displayName(address: Address | undefined): string {
  if (!address) return '(unknown)';
  return address.name?.trim() || address.email;
}

/** One Person per email address on a contact card, preferred address first. */
export function cardPeople(card: RawCard): Person[] {
  let name = '';
  if (typeof card.name === 'string') name = card.name;
  else if (card.name?.full?.trim()) name = card.name.full;
  else if (card.name?.components?.length) {
    name = card.name.components
      .filter((c) => c.kind === 'given' || c.kind === 'given2' || c.kind === 'surname' || c.kind === 'surname2')
      .map((c) => c.value ?? '')
      .filter(Boolean)
      .join(' ');
  } else name = [card.firstName, card.lastName].filter(Boolean).join(' ');
  name = name.trim();

  const emails = Array.isArray(card.emails)
    ? card.emails.map((e) => e.value ?? '')
    : Object.values(card.emails ?? {})
        .sort((a, b) => (a.pref ?? Number.MAX_SAFE_INTEGER) - (b.pref ?? Number.MAX_SAFE_INTEGER))
        .map((e) => e.address ?? '');
  return emails
    .map((e) => e.trim())
    .filter((e) => VALID_ADDRESS.test(e))
    .map((email) => ({ name, email }));
}

function toEmail(raw: RawEmail): Email {
  const parts = raw.textBody ?? [];
  let truncated = false;
  const text = parts
    .map((part) => {
      const value = raw.bodyValues?.[part.partId];
      if (!value) return '';
      if (value.isTruncated) truncated = true;
      return part.type === 'text/html' ? htmlToText(value.value) : value.value;
    })
    .join('\n')
    .trim();
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: raw.from,
    to: raw.to,
    cc: raw.cc,
    replyTo: raw.replyTo,
    subject: raw.subject,
    receivedAt: raw.receivedAt,
    messageId: raw.messageId,
    references: raw.references,
    keywords: raw.keywords,
    text,
    truncated,
  };
}

/** Rough conversion for HTML-only messages; good enough as model input. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

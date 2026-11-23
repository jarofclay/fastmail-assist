import type { Address, DraftInput, Email, Thread, ThreadSummary } from './types';

const SESSION_URL = 'https://api.fastmail.com/jmap/session';
const CORE = 'urn:ietf:params:jmap:core';
const MAIL = 'urn:ietf:params:jmap:mail';

/** Bodies longer than this are cut by the server; plenty for drafting a reply. */
const MAX_BODY_BYTES = 20_000;

const EMAIL_PROPERTIES = [
  'id', 'threadId', 'from', 'to', 'cc', 'replyTo', 'subject', 'receivedAt',
  'messageId', 'references', 'keywords', 'textBody', 'bodyValues',
];

type MethodCall = [name: string, args: Record<string, unknown>, callId: string];
type MethodResponse = [name: string, result: Record<string, unknown>, callId: string];

interface Session {
  apiUrl: string;
  accountId: string;
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
 * Minimal JMAP client. Uses only the core and mail capabilities, so a token
 * without the submission scope is enough: this code cannot send mail.
 */
export class JmapClient {
  private session?: Session;
  private mailboxes?: Mailbox[];

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
    this.session = { apiUrl: raw.apiUrl, accountId };
    return this.session;
  }

  private async call(build: (accountId: string) => MethodCall[]): Promise<MethodResponse[]> {
    const { apiUrl, accountId } = await this.getSession();
    const raw = (await this.request(apiUrl, {
      method: 'POST',
      body: JSON.stringify({ using: [CORE, MAIL], methodCalls: build(accountId) }),
    })) as { methodResponses: MethodResponse[] };
    for (const [name, result] of raw.methodResponses) {
      if (name === 'error') {
        throw new JmapError(`Fastmail API error: ${String(result.type)} ${String(result.description ?? '')}`.trim());
      }
    }
    return raw.methodResponses;
  }

  private async getMailboxId(role: 'inbox' | 'drafts'): Promise<string> {
    if (!this.mailboxes) {
      const [response] = await this.call((accountId) => [
        ['Mailbox/get', { accountId, ids: null, properties: ['id', 'role'] }, 'm'],
      ]);
      this.mailboxes = (response?.[1].list as Mailbox[] | undefined) ?? [];
    }
    const mailbox = this.mailboxes.find((m) => m.role === role);
    if (!mailbox) throw new JmapError(`No ${role} mailbox found.`);
    return mailbox.id;
  }

  /** Load a whole conversation, given either its thread id or any email in it. */
  async getThread(ref: { threadId?: string; emailId?: string }): Promise<Thread> {
    if (!ref.threadId && !ref.emailId) throw new JmapError('No conversation selected.');
    const responses = await this.call((accountId) => {
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
    const emails = raw.filter((e) => !e.keywords['$draft']).map(toEmail);
    const first = emails[0];
    if (!first) throw new JmapError('That conversation could not be found.');
    return { id: first.threadId, emails };
  }

  /** Newest inbox conversations, for the picker shown when no thread is open. */
  async recentThreads(limit = 15): Promise<ThreadSummary[]> {
    const inboxId = await this.getMailboxId('inbox');
    const responses = await this.call((accountId) => [
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

  /** Save a draft. Returns the new email id. Nothing is sent. */
  async createDraft(draft: DraftInput): Promise<string> {
    const draftsId = await this.getMailboxId('drafts');
    const [response] = await this.call((accountId) => [
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

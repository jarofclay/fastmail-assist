import { displayName } from './jmap';
import type { Address, DraftInput, Email, Identity, Thread } from './types';

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isOwn(address: Address | undefined, ownEmails: string[]): boolean {
  return Boolean(address && ownEmails.some((own) => sameAddress(own, address.email)));
}

/** The message a reply should answer: the newest one someone else wrote. */
export function pickReplyTarget(thread: Thread, ownEmails: string[]): Email {
  const fromOthers = thread.emails.filter((e) => !isOwn(e.from?.[0], ownEmails));
  const target = fromOthers.at(-1) ?? thread.emails.at(-1);
  if (!target) throw new Error('The conversation has no messages.');
  return target;
}

/** Pick the identity the conversation was addressed to, else the first one. */
export function pickIdentity(target: Email, identities: Identity[]): Identity | undefined {
  const recipients = [...(target.to ?? []), ...(target.cc ?? [])];
  return (
    identities.find((id) => recipients.some((r) => sameAddress(r.email, id.email))) ?? identities[0]
  );
}

export function replySubject(subject: string | null): string {
  const clean = (subject ?? '').trim();
  if (!clean) return 'Re:';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function quoteOriginal(target: Email): string {
  const when = new Date(target.receivedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const quoted = target.text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return `On ${when}, ${displayName(target.from?.[0])} wrote:\n${quoted}`;
}

function dedupe(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const key = a.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ReplyOptions {
  target: Email;
  identity: Identity;
  /** Every address that is "us", so reply-all never copies ourselves. */
  ownEmails: string[];
  replyAll: boolean;
  /** The reply text, without the quoted original. */
  body: string;
}

export function buildReplyDraft(options: ReplyOptions): DraftInput {
  const { target, identity, ownEmails, replyAll, body } = options;
  const own = [...ownEmails, identity.email];
  const targetIsOurs = isOwn(target.from?.[0], own);

  // Replying to our own message is a follow-up: write to its recipients again.
  const to = dedupe(
    (targetIsOurs ? target.to : target.replyTo?.length ? target.replyTo : target.from) ?? [],
  ).filter((a) => !isOwn(a, own));

  const cc = replyAll
    ? dedupe([...(targetIsOurs ? [] : (target.to ?? [])), ...(target.cc ?? [])]).filter(
        (a) => !isOwn(a, own) && !to.some((t) => sameAddress(t.email, a.email)),
      )
    : [];

  const messageId = target.messageId ?? [];
  return {
    from: { name: identity.name, email: identity.email },
    to,
    cc,
    subject: replySubject(target.subject),
    body: `${body.trim()}\n\n${quoteOriginal(target)}\n`,
    inReplyTo: messageId.length > 0 ? messageId : undefined,
    references: messageId.length > 0 ? [...(target.references ?? []), ...messageId] : undefined,
  };
}

export function buildNewDraft(identity: Identity, to: Address[], subject: string, body: string): DraftInput {
  return {
    from: { name: identity.name, email: identity.email },
    to,
    cc: [],
    subject,
    body: `${body.trim()}\n`,
  };
}

/** "Ann <ann@example.org>, bob@example.net" to addresses. Invalid entries are dropped. */
export function parseAddressList(input: string): Address[] {
  return dedupe(
    input
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry): Address | null => {
        const angle = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(entry);
        if (angle?.[2]) {
          const name = (angle[1] ?? '').trim().replace(/^"|"$/g, '');
          return name ? { name, email: angle[2] } : { email: angle[2] };
        }
        return /^[^\s@]+@[^\s@]+$/.test(entry) ? { email: entry } : null;
      })
      .filter((a): a is Address => a !== null),
  );
}

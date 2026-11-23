/**
 * Works out which conversation is open from the Fastmail tab URL.
 *
 * Fastmail's web app puts the open conversation in the path, after the
 * mailbox: `/mail/<Mailbox>/<threadId>.<emailId>?u=<user>`. Its JMAP ids are
 * short base64-style strings; thread ids start with "A" and email ids with
 * "S" (confirmed on a real account, milestone M1). The older documentation
 * shape, "T" and "M" followed by hex, is accepted as well. Only the segment
 * after a mailbox is looked at, so a mailbox called "Announcements" is not an
 * id, and a wrong guess costs one failed lookup, never a wrong draft. The
 * same literal is repeated in src/content.ts; a unit test keeps them equal.
 */
export interface MailContext {
  threadId?: string;
  emailId?: string;
}

const CONVERSATION_ID = /\/mail\/[^?#\s]+?\/(?:(T[0-9a-f]{8,}|A[A-Za-z0-9_-]{8,})(?:\.(M[0-9a-f]{8,}|S[A-Za-z0-9_-]{8,}))?|(M[0-9a-f]{8,}|S[A-Za-z0-9_-]{8,}))(?=[\s?#]|$)/;

export function isFastmailUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'app.fastmail.com';
  } catch {
    return false;
  }
}

export function parseMailContext(url: string | undefined): MailContext {
  if (!url || !isFastmailUrl(url)) return {};
  const { pathname, hash } = new URL(url);
  const match = CONVERSATION_ID.exec(`${pathname} ${hash}`);
  if (!match) return {};
  const context: MailContext = {};
  if (match[1]) context.threadId = match[1];
  const emailId = match[2] ?? match[3];
  if (emailId) context.emailId = emailId;
  return context;
}

export function hasConversation(context: MailContext): boolean {
  return Boolean(context.threadId || context.emailId);
}

export function sameConversation(a: MailContext, b: MailContext): boolean {
  if (a.threadId && b.threadId) return a.threadId === b.threadId;
  return Boolean(a.emailId) && a.emailId === b.emailId;
}

/** The Drafts folder, keeping Fastmail's `u` parameter so the same account stays selected. */
export function draftsUrl(currentUrl: string | undefined): string {
  const url = new URL('https://app.fastmail.com/mail/Drafts/');
  if (currentUrl && isFastmailUrl(currentUrl)) {
    const user = new URL(currentUrl).searchParams.get('u');
    if (user) url.searchParams.set('u', user);
  }
  return url.toString();
}

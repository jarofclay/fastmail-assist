/**
 * Works out which conversation is open from the Fastmail tab URL.
 *
 * ASSUMPTION TO VERIFY (see DESIGN.md, open question 1): Fastmail's web app
 * puts JMAP ids in the URL, a thread id starting with "T" and an email id
 * starting with "M", each followed by hex digits. The parser is deliberately
 * loose about where in the URL they sit. If the format turns out different,
 * this file is the only place to change, and the panel's "recent threads"
 * picker keeps working without it.
 */
export interface MailContext {
  threadId?: string;
  emailId?: string;
}

const THREAD_ID = /(?:^|[^A-Za-z0-9])(T[0-9a-f]{8,})(?![A-Za-z0-9])/;
const EMAIL_ID = /(?:^|[^A-Za-z0-9])(M[0-9a-f]{8,})(?![A-Za-z0-9])/;

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
  const haystack = `${pathname} ${hash}`;
  const context: MailContext = {};
  const thread = THREAD_ID.exec(haystack);
  const email = EMAIL_ID.exec(haystack);
  if (thread?.[1]) context.threadId = thread[1];
  if (email?.[1]) context.emailId = email[1];
  return context;
}

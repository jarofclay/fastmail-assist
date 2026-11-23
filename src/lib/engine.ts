import { streamMessage, type ChatMessage } from './claude';
import { displayName } from './jmap';
import { composeRequest, defaultShape, parseComposeOutput, replyRequest, systemPrompt, type Mode, type Shape } from './prompt';
import { correspondents, formatAddresses, pickIdentity, pickReplyTarget, replyRecipients } from './reply';
import type { Address, Correspondence, Email, Identity, Settings, Thread } from './types';

/** What the UI shows about the conversation a reply belongs to. */
export interface ConversationInfo {
  subject: string;
  replyTo: string;
  /** Where the reply goes, as text for a To field: "Dana Lee <dana@example.org>". */
  to: string;
  messageCount: number;
  /** Email of the identity the conversation was addressed to. */
  suggestedIdentity: string;
}

export function describeConversation(
  thread: Thread,
  settings: Settings,
): { target: Email; info: ConversationInfo; /** Whose earlier mail gives the reply its background. */ with: Address[] } {
  const ownEmails = settings.identities.map((i) => i.email);
  const target = pickReplyTarget(thread, ownEmails);
  return {
    target,
    with: correspondents(target, ownEmails),
    info: {
      subject: thread.emails[0]?.subject?.trim() || '(no subject)',
      replyTo: displayName(target.from?.[0]),
      to: formatAddresses(replyRecipients(target, ownEmails)),
      messageCount: thread.emails.length,
      suggestedIdentity: pickIdentity(target, settings.identities)?.email ?? '',
    },
  };
}

export interface DraftRequest {
  settings: Settings;
  identity: Identity;
  mode: Mode;
  shape?: Shape;
  /** Reply mode: the conversation being answered. */
  thread?: Thread;
  /** Compose mode: who the email is for, as typed. */
  recipients?: string;
  /** Earlier conversations with the recipient, when the setting is on and any were found. */
  history?: Correspondence;
  instruction: string;
  /** Set both to revise: the draft as it stands on screen, and what to change. */
  current?: string;
  revision?: string;
  signal?: AbortSignal;
  onProgress?: (draft: DraftResult) => void;
}

export interface DraftResult {
  body: string;
  /** Only when a subject was asked for and the model has written one. */
  subject: string;
  truncated: boolean;
}

export function buildChat(request: DraftRequest): ChatMessage[] {
  const ownEmails = request.settings.identities.map((i) => i.email);
  let first: string;
  if (request.mode === 'reply') {
    if (!request.thread) throw new Error('No conversation selected.');
    const target = pickReplyTarget(request.thread, ownEmails);
    first = replyRequest(request.thread, target, ownEmails, request.instruction, request.history);
  } else {
    first = composeRequest(request.recipients ?? '', request.instruction, request.history, ownEmails);
  }
  const messages: ChatMessage[] = [{ role: 'user', content: first }];
  if (request.current?.trim() && request.revision?.trim()) {
    // Manual edits carry forward: the model revises what is on screen.
    messages.push(
      { role: 'assistant', content: request.current.trim() },
      { role: 'user', content: `Revise the draft: ${request.revision.trim()}` },
    );
  }
  return messages;
}

/** Draft or revise an email, reporting partial text as it streams in. */
export async function draftEmail(request: DraftRequest): Promise<DraftResult> {
  const shape = request.shape ?? defaultShape(request.mode);
  const split = (text: string, truncated: boolean): DraftResult =>
    shape === 'subject+body' ? { ...parseComposeOutput(text), truncated } : { body: text, subject: '', truncated };

  const result = await streamMessage({
    apiKey: request.settings.anthropicKey,
    model: request.settings.model,
    system: systemPrompt(request.identity, request.mode, shape),
    messages: buildChat(request),
    signal: request.signal,
    onText: (text) => {
      // Hold back the first line until it is clear whether it is the subject.
      const firstLineOnly = shape === 'subject+body' && !text.includes('\n');
      request.onProgress?.(firstLineOnly ? { body: '', subject: '', truncated: false } : split(text, false));
    },
  });
  return split(result.text, result.truncated);
}

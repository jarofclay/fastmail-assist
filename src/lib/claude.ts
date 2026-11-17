const API_URL = 'https://api.anthropic.com/v1/messages';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MessageRequest {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export class ClaudeError extends Error {}

/**
 * One call to the Claude Messages API, straight from the extension page with
 * the user's own key. The browser-access header is required because the
 * request carries a chrome-extension:// origin.
 */
export async function createMessage(request: MessageRequest): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    signal: request.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens ?? 1500,
      system: request.system,
      messages: request.messages,
    }),
  });

  const data = (await response.json().catch(() => null)) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new ClaudeError(data?.error?.message ?? `Claude API returned HTTP ${response.status}.`);
  }
  const text = (data?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
  if (!text) throw new ClaudeError('Claude returned an empty draft.');
  return text;
}

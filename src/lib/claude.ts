const API_URL = 'https://api.anthropic.com/v1/messages';

/** Lets the API hand a declined request to another model instead of failing. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

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
  /** Called with the whole text so far each time more arrives. */
  onText?: (text: string) => void;
}

export interface MessageResult {
  text: string;
  /** True when the model hit the output limit before finishing. */
  truncated: boolean;
}

export class ClaudeError extends Error {}

interface StreamEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  error?: { message?: string };
}

/**
 * Current models take an effort level and can fall back to another model when
 * a request is declined. Older or unknown model ids get the plain request.
 */
const supportsExtras = (model: string) => /^claude-(sonnet|opus|haiku|fable|mythos)-5/.test(model);

function post(request: MessageRequest, extras: boolean): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': request.apiKey,
    'anthropic-version': '2023-06-01',
    // Required because the request carries an extension origin.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body: Record<string, unknown> = {
    model: request.model,
    // Generous on purpose: reasoning counts towards this limit on current models.
    max_tokens: request.maxTokens ?? 16_000,
    system: request.system,
    messages: request.messages,
    stream: true,
  };
  if (extras) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    // An email draft is a small task; low effort keeps it quick.
    body.output_config = { effort: 'low' };
    body.fallbacks = 'default';
  }
  return fetch(API_URL, { method: 'POST', signal: request.signal, headers, body: JSON.stringify(body) });
}

async function errorMessage(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (data?.error?.message) return data.error.message;
  if (response.status === 401) return 'Claude rejected the API key.';
  return `Claude API returned HTTP ${response.status}.`;
}

/**
 * One streamed call to the Claude Messages API, straight from the extension
 * with the user's own key.
 */
export async function streamMessage(request: MessageRequest): Promise<MessageResult> {
  let response = await post(request, supportsExtras(request.model));
  // A 400 may mean this account or model does not accept the optional fields.
  if (response.status === 400 && supportsExtras(request.model)) response = await post(request, false);
  if (!response.ok) throw new ClaudeError(await errorMessage(response));
  if (!response.body) throw new ClaudeError('Claude returned no response body.');

  let text = '';
  let stopReason: string | null = null;

  const handle = (event: StreamEvent) => {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text ?? '';
      request.onText?.(text);
    } else if (event.type === 'message_delta' && event.delta?.stop_reason !== undefined) {
      stopReason = event.delta.stop_reason;
    } else if (event.type === 'error') {
      throw new ClaudeError(event.error?.message ?? 'Claude stopped with an error.');
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        continue;
      }
      handle(event);
    }
    if (done) break;
  }

  text = text.trim();
  if (stopReason === 'refusal' && !text) throw new ClaudeError('Claude declined to write this draft.');
  if (!text) throw new ClaudeError('Claude returned an empty draft.');
  return { text, truncated: stopReason === 'max_tokens' };
}

/** Cheapest possible request, used by the settings page to check a key and model. */
export async function testKey(apiKey: string, model: string): Promise<void> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
  });
  if (!response.ok) throw new ClaudeError(await errorMessage(response));
}

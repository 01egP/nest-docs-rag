import { readSse } from './sse';
import type { AskStreamEvent } from './types';

/** The request failed before the stream started (HTTP 4xx/5xx), with the server's message if any. */
export class AskHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AskHttpError';
  }
}

const EVENT_TYPES = new Set(['retrieval', 'delta', 'done', 'error']);

/**
 * `POST /ask/stream` as typed events. POST because the question is a body, hence fetch + a reader
 * rather than EventSource (GET only). Aborting `signal` closes the connection, and the server then
 * stops generating. Unknown event names are skipped, so the server may add events later.
 */
export async function* askStream(
  question: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<AskStreamEvent> {
  const res = await fetchImpl('/api/ask/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
    signal,
  });
  if (!res.ok || !res.body) throw new AskHttpError(res.status, await errorMessage(res));

  for await (const { event, data } of readSse(res.body)) {
    if (!EVENT_TYPES.has(event)) continue;
    const payload = JSON.parse(data) as Record<string, unknown>;
    // `done` carries the whole AskResult; the other events are flat objects.
    yield (
      event === 'done' ? { type: 'done', result: payload } : { type: event, ...payload }
    ) as AskStreamEvent;
  }
}

/** Fastify's validation error (`{ message }`), the API's own (`{ error }`), or the status line. */
async function errorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (typeof body.error === 'string') return body.error;
  } catch {
    // not JSON (e.g. the dev proxy's own error page when the API is down)
  }
  return fallback;
}

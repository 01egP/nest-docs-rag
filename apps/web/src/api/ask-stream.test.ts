import { describe, expect, it, vi } from 'vitest';
import { AskHttpError, askStream } from './ask-stream';
import type { AskStreamEvent } from './types';

const sse = (text: string, init: ResponseInit = {}) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream' }, ...init });

async function collect(res: Response, question = 'q') {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(res);
  const out: AskStreamEvent[] = [];
  for await (const e of askStream(question, undefined, fetchImpl)) out.push(e);
  return { out, fetchImpl };
}

describe('askStream', () => {
  it('posts the question and types the events', async () => {
    const { out, fetchImpl } = await collect(
      sse(
        ': searching\n\n' +
          'event: retrieval\ndata: {"retrieval":{"sources":[]},"timingsMs":{"search":5}}\n\n' +
          'event: delta\ndata: {"text":"Hi"}\n\n' +
          'event: future\ndata: {}\n\n' +
          'event: done\ndata: {"answered":true,"answer":"Hi"}\n\n',
      ),
      'How?',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/ask/stream',
      expect.objectContaining({ method: 'POST', body: '{"question":"How?"}' }),
    );
    expect(out).toEqual([
      { type: 'retrieval', retrieval: { sources: [] }, timingsMs: { search: 5 } },
      { type: 'delta', text: 'Hi' },
      { type: 'done', result: { answered: true, answer: 'Hi' } },
    ]);
  });

  it('passes the error event through', async () => {
    const { out } = await collect(sse('event: error\ndata: {"error":"Could not answer"}\n\n'));
    expect(out).toEqual([{ type: 'error', error: 'Could not answer' }]);
  });

  it("throws the server's validation message on 400", async () => {
    const res = Response.json(
      { statusCode: 400, error: 'Bad Request', message: 'body/question must match pattern' },
      { status: 400 },
    );
    await expect(collect(res)).rejects.toEqual(
      new AskHttpError(400, 'body/question must match pattern'),
    );
  });

  it('falls back to the status when the body is not JSON', async () => {
    const res = new Response('<html>proxy error</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    await expect(collect(res)).rejects.toMatchObject({
      status: 502,
      message: 'HTTP 502 Bad Gateway',
    });
  });
});

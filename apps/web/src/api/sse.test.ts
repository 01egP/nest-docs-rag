import { describe, expect, it } from 'vitest';
import { readSse, type SseMessage } from './sse';

/** A body that delivers `bytes` in pieces of `size` bytes — the network may cut anywhere. */
function body(bytes: Uint8Array, size: number) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

async function collect(text: string, size = Infinity): Promise<SseMessage[]> {
  const bytes = new TextEncoder().encode(text);
  const out: SseMessage[] = [];
  for await (const m of readSse(body(bytes, Math.min(size, bytes.length || 1)))) out.push(m);
  return out;
}

// What /ask/stream sends: a comment first, then events. «Гард» — Cyrillic is 2 bytes per letter.
const STREAM =
  ': searching\n\n' +
  'event: retrieval\ndata: {"retrieval":{"sources":[]}}\n\n' +
  'event: delta\ndata: {"text":"Гард [1]"}\n\n' +
  'event: done\ndata: {"answered":true}\n\n';

const EXPECTED: SseMessage[] = [
  { event: 'retrieval', data: '{"retrieval":{"sources":[]}}' },
  { event: 'delta', data: '{"text":"Гард [1]"}' },
  { event: 'done', data: '{"answered":true}' },
];

describe('readSse', () => {
  it('reads events and skips comments', async () => {
    expect(await collect(STREAM)).toEqual(EXPECTED);
  });

  it.each([1, 2, 3, 7, 13])('gives the same events in %i-byte pieces', async (size) => {
    expect(await collect(STREAM, size)).toEqual(EXPECTED);
  });

  it('decodes a character cut between pieces', async () => {
    // "data: Г" — the 7th byte is the first half of «Г»
    const [m] = await collect('data: Гард\n\n', 7);
    expect(m).toEqual({ event: 'message', data: 'Гард' });
  });

  it('accepts CRLF and CR line endings, also cut between pieces', async () => {
    const crlf = 'event: delta\r\ndata: {"text":"a"}\r\n\r\n';
    const cr = 'event: delta\rdata: {"text":"a"}\r\r';
    const want = [{ event: 'delta', data: '{"text":"a"}' }];
    for (const size of [1, 2, 5, Infinity]) {
      expect(await collect(crlf, size)).toEqual(want);
      expect(await collect(cr, size)).toEqual(want);
    }
  });

  it('joins multi-line data and keeps a value without the optional space', async () => {
    expect(await collect('data:a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('skips id / retry fields and events without data', async () => {
    expect(await collect('id: 1\nretry: 10\n\nevent: ping\n\ndata: x\n\n')).toEqual([
      { event: 'message', data: 'x' },
    ]);
  });

  it('drops an event the stream ended in the middle of', async () => {
    expect(await collect('data: whole\n\ndata: cut')).toEqual([
      { event: 'message', data: 'whole' },
    ]);
  });

  it('cancels the body when the reader stops early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const m of readSse(stream)) {
      expect(m.data).toBe('1');
      break;
    }
    expect(cancelled).toBe(true);
  });
});

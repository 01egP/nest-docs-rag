import { describe, expect, it } from 'vitest';
import { parseNdjson } from './client.js';

async function* bytes(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

describe('parseNdjson', () => {
  it('joins lines cut across chunks and skips blank lines', async () => {
    const out = await collect(parseNdjson(bytes('{"a":1}\n{"a"', ':2}\n\n{"a":3}')));
    expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('keeps a multi-byte character split between chunks', async () => {
    const all = new TextEncoder().encode('{"t":"гварды"}\n'); // byte 7 is inside «г»
    const out = await collect(parseNdjson(bytes(all.slice(0, 7), all.slice(7))));
    expect(out).toEqual([{ t: 'гварды' }]);
  });
});

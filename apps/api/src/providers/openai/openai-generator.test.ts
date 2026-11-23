import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleGenerator, parseSseData } from './openai-generator.js';

async function* bytes(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};

const sse = (...events: unknown[]) =>
  events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

const generator = () =>
  new OpenAICompatibleGenerator({
    baseUrl: 'https://llm.example/v1/',
    apiKey: 'test-key',
    model: 'some-model',
  });

const request = {
  messages: [{ role: 'user' as const, content: 'Q?' }],
  jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

function mockFetch(response: Response) {
  const fn = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('parseSseData', () => {
  it('yields the data of each event, joining lines cut across chunks', async () => {
    const out = await collect(
      parseSseData(bytes('data: {"a":', '1}\n\n: comment\n\nda', 'ta: [DONE]\n\n')),
    );
    expect(out).toEqual(['{"a":1}', '[DONE]']);
  });

  it('handles CRLF, multi-line data and a last event without a blank line', async () => {
    const out = await collect(parseSseData(bytes('event: x\r\ndata: a\r\ndata: b\r\n\r\ndata: c')));
    expect(out).toEqual(['a\nb', 'c']);
  });

  it('keeps a multi-byte character split between chunks', async () => {
    const all = new TextEncoder().encode('data: гварды\n\n');
    const out = await collect(parseSseData(bytes(all.slice(0, 7), all.slice(7))));
    expect(out).toEqual(['гварды']);
  });
});

describe('OpenAICompatibleGenerator', () => {
  it('sends the key, the model and the schema as strict structured output', async () => {
    const fetchMock = mockFetch(
      Response.json({
        model: 'some-model',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
    );

    const result = await generator().generate(request);

    expect(result).toEqual({
      text: '{"ok":true}',
      model: 'some-model',
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(JSON.parse(init!.body as string)).toEqual({
      model: 'some-model',
      messages: request.messages,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true, schema: request.jsonSchema },
      },
    });
  });

  it('streams deltas, then the whole text with usage from the last chunk', async () => {
    const fetchMock = mockFetch(
      new Response(
        sse(
          { model: 'some-model', choices: [{ delta: { role: 'assistant', content: '{"a":' } }] },
          { choices: [{ delta: { content: '1}' } }] },
          {
            choices: [{ delta: { content: '' } }],
            usage: { prompt_tokens: 7, completion_tokens: 2 },
          },
          '[DONE]',
        ),
      ),
    );

    const chunks = await collect(generator().stream(request));

    expect(chunks).toEqual([
      { type: 'delta', text: '{"a":' },
      { type: 'delta', text: '1}' },
      {
        type: 'done',
        result: {
          text: '{"a":1}',
          model: 'some-model',
          usage: { inputTokens: 7, outputTokens: 2 },
        },
      },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('fails on an HTTP error, a 200 without choices, or a stream cut before [DONE]', async () => {
    mockFetch(new Response('{"error":"bad key"}', { status: 401 }));
    await expect(generator().generate(request)).rejects.toThrow(/HTTP 401.*bad key/);

    mockFetch(Response.json({ success: false, error: 'missing input' }));
    await expect(generator().generate(request)).rejects.toThrow(/missing input/);

    mockFetch(new Response(sse({ error: 'overloaded' })));
    await expect(collect(generator().stream(request))).rejects.toThrow(/overloaded/);

    mockFetch(new Response(sse({ choices: [{ delta: { content: '{' } }] })));
    await expect(collect(generator().stream(request))).rejects.toThrow(/without \[DONE\]/);
  });

  it('passes the abort signal to fetch', async () => {
    const fetchMock = mockFetch(Response.json({ choices: [{ message: { content: '' } }] }));
    const controller = new AbortController();
    await generator().generate({ ...request, signal: controller.signal });
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(controller.signal);
  });
});

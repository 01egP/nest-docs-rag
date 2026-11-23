import type { GenerateChunk, GenerateRequest, GenerateResult, Generator } from '../types.js';

/**
 * Any OpenAI-compatible Chat Completions API: OpenAI itself, or a gateway that speaks the same
 * protocol (e.g. Abacus RouteLLM, which serves Claude, Gemini, GPT and open models behind one key).
 * The base URL picks the service, the model name picks the model.
 */
export interface OpenAICompatibleOptions {
  /** Up to and including the version, e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface CompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: Usage;
  /** Some gateways answer 200 with an error object instead of `choices`. */
  error?: unknown;
}

interface CompletionChunk {
  model?: string;
  choices?: { delta?: { content?: string | null } }[];
  /** Sent in the last chunk when `stream_options.include_usage` is set. */
  usage?: Usage | null;
  error?: unknown;
}

export class OpenAICompatibleGenerator implements Generator {
  readonly id: string;
  readonly model: string;
  private readonly url: string;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.model = options.model;
    this.id = `openai:${options.model}`;
    this.url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.post(request, false);
    const data = (await res.json()) as CompletionResponse;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error(`Chat completions: ${describe(data)}`);
    return this.result(text, data.model, data.usage);
  }

  async *stream(request: GenerateRequest): AsyncIterable<GenerateChunk> {
    const res = await this.post(request, true);
    if (!res.body) throw new Error('Chat completions: empty response body');
    let text = '';
    let model: string | undefined;
    let usage: Usage | undefined;
    for await (const data of parseSseData(res.body)) {
      if (data === '[DONE]') {
        yield { type: 'done', result: this.result(text, model, usage) };
        return;
      }
      const chunk = JSON.parse(data) as CompletionChunk;
      if (chunk.error) throw new Error(`Chat completions: ${describe(chunk)}`);
      model ??= chunk.model;
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
    }
    throw new Error('Chat completions: stream ended without [DONE]');
  }

  private async post(request: GenerateRequest, stream: boolean): Promise<Response> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(this.body(request, stream)),
      signal: request.signal,
    });
    // The key is only in the request headers, never in this message.
    if (!res.ok) throw new Error(`Chat completions: HTTP ${res.status} ${await res.text()}`);
    return res;
  }

  private body(request: GenerateRequest, stream: boolean) {
    return {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      ...(stream && { stream: true, stream_options: { include_usage: true } }),
      // Strict structured output; the schema must list every property as required and set
      // `additionalProperties: false` (ANSWER_SCHEMA does).
      ...(request.jsonSchema && {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', strict: true, schema: request.jsonSchema },
        },
      }),
    };
  }

  private result(
    text: string,
    model: string | undefined,
    usage: Usage | undefined,
  ): GenerateResult {
    return {
      text,
      model: model ?? this.model,
      usage: { inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens },
    };
  }
}

const describe = (data: unknown) => JSON.stringify(data).slice(0, 500);

/**
 * Server-sent events → the `data` of each event. Events are separated by a blank line; a field line
 * may arrive cut across network chunks, and lines that are not `data:` (comments, `event:`) are
 * skipped. Multi-line data is joined with "\n", as the SSE spec says.
 */
export async function* parseSseData(body: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];

  function* line(raw: string) {
    const l = raw.replace(/\r$/, '');
    if (l === '') {
      if (data.length) yield data.join('\n');
      data = [];
    } else if (l.startsWith('data:')) {
      data.push(l.slice(5).replace(/^ /, ''));
    }
  }

  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      yield* line(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) yield* line(buffer);
  yield* line('');
}

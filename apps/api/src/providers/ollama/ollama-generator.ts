import type { GenerateChunk, GenerateRequest, GenerateResult, Generator } from '../types.js';
import type { OllamaClient } from './client.js';

interface ChatResponse {
  model: string;
  message: { role: string; content: string };
  done?: boolean;
  /** Error reported mid-stream; the HTTP status is already 200 by then. */
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaGenerator implements Generator {
  readonly id: string;

  constructor(
    private readonly client: OllamaClient,
    readonly model: string,
    /** Reasoning ("thinking") mode for models that support it, e.g. qwen3. */
    private readonly think = false,
    /** Context window in tokens; Ollama's own default may be smaller than a RAG prompt. */
    private readonly numCtx?: number,
  ) {
    this.id = `ollama:${model}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.client.post<ChatResponse>(
      '/api/chat',
      this.body(request, false),
      request.signal,
    );
    return this.result(res, res.message.content);
  }

  async *stream(request: GenerateRequest): AsyncIterable<GenerateChunk> {
    let text = '';
    for await (const part of this.client.postStream<ChatResponse>(
      '/api/chat',
      this.body(request, true),
      request.signal,
    )) {
      if (part.error) throw new Error(`Ollama /api/chat: ${part.error}`);
      const delta = part.message?.content ?? '';
      if (delta) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
      // The last line carries the token counts; its message content is empty.
      if (part.done) {
        yield { type: 'done', result: this.result(part, text) };
        return;
      }
    }
    throw new Error('Ollama /api/chat: stream ended without "done"');
  }

  private body(request: GenerateRequest, stream: boolean) {
    return {
      model: this.model,
      messages: request.messages,
      stream,
      think: this.think,
      // Ollama structured output: a JSON Schema constrains decoding to valid JSON, streamed or not.
      ...(request.jsonSchema && { format: request.jsonSchema }),
      options: {
        temperature: request.temperature ?? 0,
        ...(this.numCtx && { num_ctx: this.numCtx }),
      },
    };
  }

  private result(res: ChatResponse, text: string): GenerateResult {
    return {
      text,
      model: res.model,
      usage: { inputTokens: res.prompt_eval_count, outputTokens: res.eval_count },
    };
  }
}

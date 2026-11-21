import type { GenerateRequest, GenerateResult, Generator } from '../types.js';
import type { OllamaClient } from './client.js';

interface ChatResponse {
  model: string;
  message: { role: string; content: string };
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
  ) {
    this.id = `ollama:${model}`;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const res = await this.client.post<ChatResponse>('/api/chat', {
      model: this.model,
      messages: request.messages,
      stream: false,
      think: this.think,
      // Ollama structured output: a JSON Schema constrains decoding to valid JSON.
      ...(request.jsonSchema && { format: request.jsonSchema }),
      options: { temperature: request.temperature ?? 0 },
    });
    return {
      text: res.message.content,
      model: res.model,
      usage: { inputTokens: res.prompt_eval_count, outputTokens: res.eval_count },
    };
  }
}

/** Minimal Ollama REST client: just the endpoints this app uses. https://docs.ollama.com/api */
export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.request(path, body, signal);
    return (await res.json()) as T;
  }

  /**
   * Streaming endpoints (`"stream": true`) answer with newline-delimited JSON: one object per line,
   * the last one with `"done": true`. Yields the objects as they arrive.
   */
  async *postStream<T>(path: string, body: unknown, signal?: AbortSignal): AsyncIterable<T> {
    const res = await this.request(path, body, signal);
    if (!res.body) throw new Error(`Ollama ${path}: empty response body`);
    yield* parseNdjson<T>(res.body);
  }

  /** Names of locally pulled models, e.g. ["bge-m3:latest", "qwen3:8b"]. */
  async listModels(): Promise<string[]> {
    const res = await fetch(new URL('/api/tags', this.baseUrl));
    if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`);
    const data = (await res.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  }

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama ${path}: HTTP ${res.status} ${await res.text()}`);
    return res;
  }
}

/** Splits a byte stream into JSON lines; a line may arrive cut across network chunks. */
export async function* parseNdjson<T>(body: AsyncIterable<Uint8Array>): AsyncIterable<T> {
  // `stream: true` keeps a multi-byte character cut between chunks (Cyrillic) for the next call.
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

/** Ollama treats "bge-m3" and "bge-m3:latest" as the same model. */
export function sameModel(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(':') ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

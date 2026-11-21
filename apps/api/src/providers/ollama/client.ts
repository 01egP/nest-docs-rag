/** Minimal Ollama REST client: just the endpoints this app uses. https://docs.ollama.com/api */
export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ollama ${path}: HTTP ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Names of locally pulled models, e.g. ["bge-m3:latest", "qwen3:8b"]. */
  async listModels(): Promise<string[]> {
    const res = await fetch(new URL('/api/tags', this.baseUrl));
    if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`);
    const data = (await res.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  }
}

/** Ollama treats "bge-m3" and "bge-m3:latest" as the same model. */
export function sameModel(a: string, b: string): boolean {
  const norm = (s: string) => (s.includes(':') ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

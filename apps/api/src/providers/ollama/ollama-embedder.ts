import type { Embedder, EmbedKind } from '../types.js';
import { getEmbeddingModel, type EmbeddingModelSpec } from '../embedding-models.js';
import type { OllamaClient } from './client.js';

export class OllamaEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly spec: EmbeddingModelSpec;

  constructor(
    private readonly client: OllamaClient,
    readonly model: string,
    private readonly usePrefixes = true,
  ) {
    this.spec = getEmbeddingModel(model);
    this.id = `ollama:${model}`;
    this.dimensions = this.spec.dimensions;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const prefix = this.usePrefixes
      ? kind === 'query'
        ? this.spec.queryPrefix
        : this.spec.documentPrefix
      : '';

    // /api/embed returns L2-normalized vectors, so cosine similarity == dot product.
    const { embeddings } = await this.client.post<{ embeddings: number[][] }>('/api/embed', {
      model: this.model,
      input: texts.map((t) => prefix + t),
    });

    if (embeddings.length !== texts.length) {
      throw new Error(`${this.id}: expected ${texts.length} vectors, got ${embeddings.length}`);
    }
    const wrong = embeddings.find((v) => v.length !== this.dimensions);
    if (wrong) {
      throw new Error(`${this.id}: expected dimension ${this.dimensions}, got ${wrong.length}`);
    }
    return embeddings;
  }
}

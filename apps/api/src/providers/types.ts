/**
 * Provider-agnostic contracts. The rest of the app (indexing, search, /ask) depends only on these,
 * so a local Ollama model and a paid API (OpenAI, Claude) are interchangeable via env.
 */

/**
 * Some embedding models are trained with different prefixes for the question and for the stored
 * passage (asymmetric retrieval), so the embedder has to know which side it is embedding.
 */
export type EmbedKind = 'query' | 'document';

export interface Embedder {
  /** Stable identifier, e.g. "ollama:bge-m3". Vectors are only comparable within one id. */
  readonly id: string;
  readonly model: string;
  /** Vector length; fixes the `vector(N)` column of this model's chunk table. */
  readonly dimensions: number;
  /** One vector per input text, in the same order. */
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  /** JSON Schema the answer must follow (structured output). Plain text if omitted. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface Generator {
  /** Stable identifier, e.g. "ollama:qwen3:8b". */
  readonly id: string;
  readonly model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Second-stage scorer: reads the query and each candidate together (a cross-encoder) and returns
 * how well the candidate answers the query. Slower than vector search, so it only re-orders the
 * few dozen candidates that search already found.
 */
export interface Reranker {
  /** Stable identifier, e.g. "transformers:onnx-community/bge-reranker-v2-m3-ONNX". */
  readonly id: string;
  readonly model: string;
  /** One relevance score in [0, 1] per document, in input order. */
  score(query: string, documents: string[]): Promise<number[]>;
}

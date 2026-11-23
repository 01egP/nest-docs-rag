// The API's response shapes, as the page uses them. Source of truth: apps/api/src/ask/ask.ts
// (`AskResult`, `AskEvent`) and apps/api/src/server.ts (`/health`). Kept as a copy so the web app
// does not compile the API's server-side imports.

export type NotAnsweredReason = 'below_threshold' | 'model_declined' | 'no_citations';

export interface Source {
  /** The number used in the answer's `[n]` markers. */
  n: number;
  url: string;
  title: string;
  score: number;
}

export interface Citation extends Source {
  content: string;
}

export interface Retrieval {
  table: string;
  reranked: boolean;
  topScore: number;
  minScore: number;
  /** Everything retrieved, in the order (and numbering) the model saw it. */
  sources: Source[];
}

export interface AskResult {
  answered: boolean;
  answer: string;
  /** Why there is no answer; absent when `answered`. */
  reason?: NotAnsweredReason;
  citations: Citation[];
  retrieval: Retrieval;
  generator?: { id: string; inputTokens?: number; outputTokens?: number };
  timingsMs: { search: number; generate?: number; total: number };
}

/** What `POST /ask/stream` sends, in order: `retrieval`, `delta`…, then `done` or `error`. */
export type AskStreamEvent =
  | { type: 'retrieval'; retrieval: Retrieval; timingsMs: { search: number } }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: AskResult }
  | { type: 'error'; error: string };

export interface Health {
  ok: boolean;
  db: { ok: boolean; pgvector?: string; error?: string };
  /** Only the models served by Ollama; a hosted generator is not checked here. */
  models: { ok: boolean; error?: string };
  embedder: { id: string; dimensions: number };
  generator: { id: string };
  reranker?: { id: string } | null;
}

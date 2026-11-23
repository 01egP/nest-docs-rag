/**
 * Question → grounded answer with citations (ADR-002):
 *
 * 1. Embed the question, search the chunk table (reranked, one chunk per section).
 * 2. Best hit below the threshold → "not in the docs" right away; the LLM is not called. Cheap and
 *    deterministic, but only catches clearly unrelated questions.
 * 3. Otherwise the chunks go into the prompt numbered [1]…[k] and the model answers as JSON
 *    `{answerable, answer, citations}`. `answerable` is the second refusal: questions about a
 *    neighbouring framework (Angular, Django) share vocabulary with the docs and pass the threshold.
 * 4. The server keeps only citation numbers that point at a chunk it actually sent and attaches that
 *    chunk's URL and text itself, so the model can't invent a source.
 *
 * `askStream` runs these steps as events (sources first, then the answer text as it is generated);
 * `ask` is the same pipeline returning only the final result.
 */
import type pg from 'pg';
import { getEmbeddingModel } from '../providers/embedding-models.js';
import type {
  ChatMessage,
  Embedder,
  GenerateRequest,
  GenerateResult,
  Generator,
  Reranker,
} from '../providers/types.js';
import { DEFAULT_TOP_K, searchChunks, type SearchHit } from '../search/search.js';
import { AnswerDeltas } from './partial-answer.js';

/**
 * Default thresholds, from `npm run eval` on the 15 questions (2026-11-22).
 * Reranker (bge-reranker-v2-m3): answerable questions ≥ 0.156, off-topic 0.001 / 0.017 / 0.427 —
 * 0.1 drops the clearly unrelated ones and leaves the rest to the model.
 */
export const RERANKER_MIN_SCORE = 0.1;
/**
 * Cosine thresholds per embedding model, used when reranking is off. bge-m3: answerable ≥ 0.611,
 * off-topic 0.457 / 0.631 / 0.637. Models not measured yet have no threshold (0).
 */
export const VECTOR_MIN_SCORE: Record<string, number> = { 'bge-m3': 0.5 };

export function defaultMinScore(embedModel: string, reranked: boolean): number {
  if (reranked) return RERANKER_MIN_SCORE;
  getEmbeddingModel(embedModel); // reject unknown models the same way as everywhere else
  return VECTOR_MIN_SCORE[embedModel.replace(/:latest$/, '')] ?? 0;
}

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    // First, so the model commits to whether the sources cover the question before writing.
    answerable: { type: 'boolean' },
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['answerable', 'answer', 'citations'],
} as const;

const SYSTEM_PROMPT = `You answer questions about the NestJS framework using ONLY the numbered sources from its official documentation.

Rules:
- Use only facts stated in the sources. Do not use outside knowledge.
- If the sources do not answer the question (for example, it is about another framework), set "answerable" to false and leave "answer" empty.
- Otherwise set "answerable" to true and answer concisely, putting the source number in square brackets, like [2], after each claim it supports.
- List every source number you used in "citations".
- Answer in the language of the question. Keep code identifiers, decorators and API names as they are in the sources.`;

/** "Guards › Binding guards" — the chunk's place in the docs, without the URL (see `buildPrompt`). */
const titleOf = (hit: SearchHit) => hit.headingPath.join(' › ');

/**
 * Sources are numbered from 1 in score order. URLs are left out on purpose: the model only needs to
 * point at a number, and a URL in the prompt invites it to copy or alter links in the answer.
 */
export function buildPrompt(question: string, hits: SearchHit[]): ChatMessage[] {
  const sources = hits.map((h, i) => `[${i + 1}] ${titleOf(h)}\n${h.content}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Sources:\n\n${sources}\n\nQuestion: ${question}` },
  ];
}

export interface ParsedAnswer {
  answerable: boolean;
  answer: string;
  /** Valid source numbers (1…sourceCount), unique, in order of first mention. */
  citations: number[];
}

/**
 * Validates the model's JSON against what was actually sent: numbers outside 1…sourceCount are
 * dropped from both the list and the `[n]` markers in the text; markers the model wrote but forgot to
 * list are added. Throws if the text is not the expected JSON (structured output makes that rare).
 */
export function parseAnswer(text: string, sourceCount: number): ParsedAnswer {
  const raw = JSON.parse(text) as Partial<Record<keyof ParsedAnswer, unknown>>;
  if (typeof raw.answerable !== 'boolean' || typeof raw.answer !== 'string') {
    throw new Error(`Unexpected answer shape: ${text.slice(0, 200)}`);
  }
  const valid = (n: unknown): n is number =>
    Number.isInteger(n) && (n as number) >= 1 && (n as number) <= sourceCount;

  const answer = raw.answer
    .replace(/\[(\d+)\]/g, (marker, n: string) => (valid(Number(n)) ? marker : ''))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  const inText = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const listed = Array.isArray(raw.citations) ? raw.citations : [];
  const citations = [...new Set([...listed, ...inText])].filter(valid);

  return { answerable: raw.answerable, answer, citations };
}

export type NotAnsweredReason = 'below_threshold' | 'model_declined' | 'no_citations';

export interface Citation {
  /** The number used in the answer's `[n]` markers. */
  n: number;
  url: string;
  title: string;
  content: string;
  score: number;
}

export interface AskResult {
  answered: boolean;
  answer: string;
  /** Why there is no answer; absent when `answered`. */
  reason?: NotAnsweredReason;
  citations: Citation[];
  retrieval: {
    table: string;
    reranked: boolean;
    topScore: number;
    minScore: number;
    /** Everything retrieved, in the order (and numbering) the model saw it. */
    sources: { n: number; url: string; title: string; score: number }[];
  };
  generator?: { id: string; inputTokens?: number; outputTokens?: number };
  timingsMs: { search: number; generate?: number; total: number };
}

export interface AskDeps {
  pool: Pick<pg.Pool, 'query'>;
  table: string;
  embedder: Embedder;
  generator: Generator;
  reranker: Reranker | null;
  minScore: number;
  k?: number;
}

const NOT_IN_DOCS = {
  en: "The NestJS docs don't seem to cover this.",
  ru: 'В документации NestJS этого, похоже, нет.',
};
/** The fixed refusal in the language of the question (the docs are English, questions may be not). */
export const notInDocsMessage = (question: string) =>
  /[а-яё]/i.test(question) ? NOT_IN_DOCS.ru : NOT_IN_DOCS.en;

const since = (t: number) => Math.round(performance.now() - t);

/**
 * What `/ask/stream` sends, in order: `retrieval` once search is done (sources can be shown while the
 * model writes), `delta` pieces of the answer text, then `done` with the same object `POST /ask`
 * returns. `done.result.answer` is authoritative: the deltas are the raw text, before citation
 * numbers that point at no source are dropped, so a client replaces the streamed text with it.
 * A refusal sends no deltas.
 */
export type AskEvent =
  | { type: 'retrieval'; retrieval: AskResult['retrieval']; timingsMs: { search: number } }
  | { type: 'delta'; text: string }
  | { type: 'done'; result: AskResult };

/** Model text as deltas plus the final result; a generator without `stream` sends it in one piece. */
async function* generateChunks(generator: Generator, request: GenerateRequest) {
  if (generator.stream) {
    yield* generator.stream(request);
    return;
  }
  const result = await generator.generate(request);
  yield { type: 'delta', text: result.text } as const;
  yield { type: 'done', result } as const;
}

export async function* askStream(
  deps: AskDeps,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  const started = performance.now();
  const [vector] = await deps.embedder.embed([question], 'query');
  const hits = await searchChunks(deps.pool as pg.Pool, deps.table, vector!, {
    k: deps.k ?? DEFAULT_TOP_K,
    ...(deps.reranker && { rerank: { reranker: deps.reranker, query: question } }),
  });
  const search = since(started);

  const topScore = hits[0]?.score ?? 0;
  const retrieval = {
    table: deps.table,
    reranked: Boolean(deps.reranker),
    topScore,
    minScore: deps.minScore,
    sources: hits.map((h, i) => ({ n: i + 1, url: h.url, title: titleOf(h), score: h.score })),
  };
  yield { type: 'retrieval', retrieval, timingsMs: { search } };

  const refuse = (reason: NotAnsweredReason, extra: Partial<AskResult> = {}): AskEvent => ({
    type: 'done',
    result: {
      answered: false,
      answer: notInDocsMessage(question),
      reason,
      citations: [],
      retrieval,
      timingsMs: { search, total: since(started) },
      ...extra,
    },
  });

  if (!hits.length || topScore < deps.minScore) {
    yield refuse('below_threshold');
    return;
  }

  const genStarted = performance.now();
  const deltas = new AnswerDeltas();
  let result: GenerateResult | undefined;
  for await (const chunk of generateChunks(deps.generator, {
    messages: buildPrompt(question, hits),
    jsonSchema: ANSWER_SCHEMA,
    signal,
  })) {
    if (chunk.type === 'done') {
      result = chunk.result;
      break;
    }
    const text = deltas.push(chunk.text);
    if (text) yield { type: 'delta', text };
  }
  if (!result) throw new Error('Generator finished without a result');

  const generate = since(genStarted);
  const parsed = parseAnswer(result.text, hits.length);
  const generator = { id: deps.generator.id, ...result.usage };
  const timingsMs = { search, generate, total: since(started) };

  if (!parsed.answerable) {
    yield refuse('model_declined', { generator, timingsMs });
    return;
  }
  // An answer that points at none of the sources is not grounded, whatever it says.
  if (!parsed.citations.length) {
    yield refuse('no_citations', { generator, timingsMs });
    return;
  }

  yield {
    type: 'done',
    result: {
      answered: true,
      answer: parsed.answer,
      citations: parsed.citations.map((n) => {
        const h = hits[n - 1]!;
        return { n, url: h.url, title: titleOf(h), content: h.content, score: h.score };
      }),
      retrieval,
      generator,
      timingsMs,
    },
  };
}

/** The whole answer at once (`POST /ask`, eval): the same pipeline as the stream, drained. */
export async function ask(deps: AskDeps, question: string): Promise<AskResult> {
  for await (const event of askStream(deps, question)) {
    if (event.type === 'done') return event.result;
  }
  throw new Error('ask finished without a result');
}

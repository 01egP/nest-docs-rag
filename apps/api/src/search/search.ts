/**
 * Vector search over one model's chunk table: the k nearest chunks by cosine similarity.
 * Whether the best hit is good enough to answer is decided by the caller against a per-model
 * threshold (ADR-002) — the search itself always returns up to k rows.
 *
 * The docs repeat themselves (tutorials and recipes retell the core pages, a long section is
 * split into several chunks), so the raw nearest neighbours tend to fill all k slots with one
 * section. We fetch a wider candidate pool and keep at most `maxPerSection` chunks per section
 * (URL with anchor) and, optionally, `maxPerPage` per page.
 *
 * With a reranker, the candidates are re-scored by a cross-encoder that reads the question and each
 * chunk together, re-sorted, and only then diversified — so `score` is the reranker's.
 */
import type pg from 'pg';
import pgvector from 'pgvector/pg';
import { embedTextFor } from '../ingest/store.js';
import type { Reranker } from '../providers/index.js';

export const DEFAULT_TOP_K = 6;
/**
 * Candidates fetched before diversifying. Stays within pgvector's default `hnsw.ef_search` (40):
 * an HNSW scan returns at most ef_search rows, so asking for more would silently get fewer.
 */
export const DEFAULT_CANDIDATES = 30;

export interface SearchHit {
  id: number;
  url: string;
  headingPath: string[];
  content: string;
  /** Cosine similarity (1 = same direction), or the reranker's relevance in [0, 1] if reranked. */
  score: number;
  /** Cosine similarity, kept when `score` was replaced by a reranker. */
  vectorScore?: number;
}

export interface DiversifyOptions {
  /** At most this many chunks with the same URL incl. anchor; `Infinity` = no limit. Default 1. */
  maxPerSection?: number;
  /** At most this many chunks from the same page (URL without anchor). Default: no limit. */
  maxPerPage?: number;
}

export interface SearchOptions extends DiversifyOptions {
  k?: number;
  /** Size of the nearest-neighbour pool to diversify from; ignored when it is below k. */
  candidates?: number;
  /**
   * Re-order the candidates with a cross-encoder; needs the question text. `withHeadings` must match
   * how the index was embedded (EMBED_HEADINGS), so the reranker reads the same text.
   */
  rerank?: { reranker: Reranker; query: string; withHeadings?: boolean };
}

/** Re-score hits with a cross-encoder and sort by its score; the cosine moves to `vectorScore`. */
export async function rerankHits(
  reranker: Reranker,
  query: string,
  hits: SearchHit[],
  withHeadings = true,
): Promise<SearchHit[]> {
  // The reranker sees the same text the embedding was made from: heading chain (if any) + chunk.
  const scores = await reranker.score(
    query,
    hits.map((h) => embedTextFor(h.headingPath, h.content, withHeadings)),
  );
  return hits
    .map((h, i) => ({ ...h, vectorScore: h.score, score: scores[i]! }))
    .sort((a, b) => b.score - a.score);
}

const pageOf = (url: string) => url.split('#', 1)[0]!;

/**
 * Greedy pass over hits sorted by score: keep a hit unless its section or page is already full.
 * Order is preserved, so the result is still sorted by score.
 */
export function diversify(
  hits: SearchHit[],
  k: number,
  { maxPerSection = 1, maxPerPage = Infinity }: DiversifyOptions = {},
): SearchHit[] {
  const perSection = new Map<string, number>();
  const perPage = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    if (out.length >= k) break;
    const page = pageOf(h.url);
    const s = perSection.get(h.url) ?? 0;
    const p = perPage.get(page) ?? 0;
    if (s >= maxPerSection || p >= maxPerPage) continue;
    perSection.set(h.url, s + 1);
    perPage.set(page, p + 1);
    out.push(h);
  }
  return out;
}

export async function searchChunks(
  pool: pg.Pool,
  table: string,
  queryVector: number[],
  { k = DEFAULT_TOP_K, candidates = DEFAULT_CANDIDATES, rerank, ...limits }: SearchOptions = {},
): Promise<SearchHit[]> {
  // ORDER BY the distance operator itself so the HNSW index is used; similarity = 1 - distance.
  const { rows } = await pool.query<{
    id: string;
    url: string;
    heading_path: string[];
    content: string;
    distance: number;
  }>(
    `SELECT id, url, heading_path, content, embedding <=> $1 AS distance
       FROM ${table}
      ORDER BY embedding <=> $1
      LIMIT $2`,
    [pgvector.toSql(queryVector), Math.max(k, candidates)],
  );
  const hits = rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    headingPath: r.heading_path,
    content: r.content,
    score: 1 - r.distance,
  }));
  const ordered = rerank
    ? await rerankHits(rerank.reranker, rerank.query, hits, rerank.withHeadings)
    : hits;
  return diversify(ordered, k, limits);
}

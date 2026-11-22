/**
 * Vector search over one model's chunk table: the k nearest chunks by cosine similarity.
 * Whether the best hit is good enough to answer is decided by the caller against a per-model
 * threshold (ADR-002) — the search itself always returns k rows.
 */
import type pg from 'pg';
import pgvector from 'pgvector/pg';

export const DEFAULT_TOP_K = 6;

export interface SearchHit {
  id: number;
  url: string;
  headingPath: string[];
  content: string;
  /** Cosine similarity, 1 = same direction. */
  score: number;
}

export async function searchChunks(
  pool: pg.Pool,
  table: string,
  queryVector: number[],
  k = DEFAULT_TOP_K,
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
    [pgvector.toSql(queryVector), k],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    url: r.url,
    headingPath: r.heading_path,
    content: r.content,
    score: 1 - r.distance,
  }));
}

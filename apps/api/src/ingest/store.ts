/**
 * One table per embedding model (ADR-001): vectors of different models live in different spaces
 * and often have different lengths, so they never share a column.
 *
 * Indexing is a sync, not an append: a chunk is identified by the hash of what gets embedded, so a
 * re-run embeds only new or changed chunks and deletes the ones that disappeared from the docs.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import pgvector from 'pgvector/pg';

export interface ChunkRecord {
  sourcePath: string;
  url: string;
  headingPath: string[];
  position: number;
  content: string;
  tokens: number;
  /** Exactly the text sent to the embedder. */
  embedText: string;
}

export interface SyncStats {
  total: number;
  embedded: number;
  unchanged: number;
  deleted: number;
}

/** Headings go into the vector too: a chunk of a "Guards" page is about guards even if it never says so. */
export function embedTextFor(headingPath: string[], content: string): string {
  return headingPath.length ? `${headingPath.join(' > ')}\n\n${content}` : content;
}

export function contentHash(record: Pick<ChunkRecord, 'url' | 'embedText'>): string {
  return createHash('sha256').update(`${record.url}\n${record.embedText}`).digest('hex');
}

/**
 * "chunks_bge_m3". Prefixes change the vectors of models that use them, so an index built without
 * them gets its own table ("_noprefix"); `suffix` names other experiments (e.g. a chunk size).
 */
export function tableName(model: string, opts: { noPrefix?: boolean; suffix?: string } = {}) {
  const parts = [
    'chunks',
    model.replace(/:latest$/, ''),
    opts.noPrefix ? 'noprefix' : '',
    opts.suffix ?? '',
  ];
  const name = parts
    .filter(Boolean)
    .join('_')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  if (name.length > 63) throw new Error(`Table name too long for Postgres: ${name}`);
  return name;
}

export async function ensureTable(pool: pg.Pool, table: string, dimensions: number): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id             bigserial PRIMARY KEY,
      content_hash   text NOT NULL UNIQUE,
      source_path    text NOT NULL,
      url            text NOT NULL,
      heading_path   text[] NOT NULL,
      position       int NOT NULL,
      content        text NOT NULL,
      token_estimate int NOT NULL,
      source_commit  text NOT NULL,
      embedding      vector(${dimensions}) NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )`);
  // Vectors from Ollama are L2-normalised, so cosine distance ranks exactly like inner product.
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${table}_embedding_idx ON ${table} USING hnsw (embedding vector_cosine_ops)`,
  );

  // CREATE TABLE IF NOT EXISTS keeps an old table as is — make sure it was built for this length.
  const { rows } = await pool.query<{ dims: number }>(
    `SELECT atttypmod AS dims FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'embedding'`,
    [table],
  );
  if (rows[0]?.dims !== dimensions) {
    throw new Error(
      `${table}.embedding is vector(${rows[0]?.dims}), the model gives ${dimensions}`,
    );
  }
}

export async function syncChunks(
  pool: pg.Pool,
  table: string,
  records: ChunkRecord[],
  commit: string,
  embed: (texts: string[]) => Promise<number[][]>,
  {
    batchSize = 32,
    onProgress,
  }: { batchSize?: number; onProgress?: (done: number, todo: number) => void } = {},
): Promise<SyncStats> {
  // The same text can occur twice (boilerplate); it only needs one row.
  const wanted = new Map(records.map((r) => [contentHash(r), r]));

  const { rows } = await pool.query<{ content_hash: string }>(`SELECT content_hash FROM ${table}`);
  const existing = new Set(rows.map((r) => r.content_hash));
  const todo = [...wanted].filter(([hash]) => !existing.has(hash));
  const stale = [...existing].filter((hash) => !wanted.has(hash));

  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const vectors = await embed(batch.map(([, r]) => r.embedText));
    const values: unknown[] = [];
    const tuples = batch.map(([hash, r], j) => {
      values.push(
        hash,
        r.sourcePath,
        r.url,
        r.headingPath,
        r.position,
        r.content,
        r.tokens,
        commit,
      );
      values.push(pgvector.toSql(vectors[j]!));
      const base = j * 9;
      return `(${Array.from({ length: 9 }, (_, k) => `$${base + k + 1}`).join(', ')})`;
    });
    await pool.query(
      `INSERT INTO ${table}
         (content_hash, source_path, url, heading_path, position, content, token_estimate, source_commit, embedding)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (content_hash) DO NOTHING`,
      values,
    );
    onProgress?.(Math.min(i + batchSize, todo.length), todo.length);
  }

  // Deleted last: an interrupted run leaves the old rows searchable instead of a hole.
  if (stale.length) {
    await pool.query(`DELETE FROM ${table} WHERE content_hash = ANY($1)`, [stale]);
  }

  return {
    total: wanted.size,
    embedded: todo.length,
    unchanged: wanted.size - todo.length,
    deleted: stale.length,
  };
}

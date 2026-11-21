/**
 * Index the NestJS docs into pgvector for the configured embedding model.
 *   npm run ingest                    fetch/update the docs, chunk, embed what changed
 *   npm run ingest -- --dry-run       chunk only: stats and samples, no embedding, no database
 *   npm run ingest -- --offline       use the existing clone as is
 *   npm run ingest -- --suffix c400 --max-tokens 400   a separate index for an experiment
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { getEmbeddingModel } from '../providers/embedding-models.js';
import { createEmbedder } from '../providers/index.js';
import { chunkMarkdown, DEFAULT_CHUNK_OPTIONS } from '../ingest/chunker.js';
import { cleanMarkdown } from '../ingest/markdown.js';
import { DEFAULT_SOURCE_DIR, listPages, syncSource } from '../ingest/source.js';
import {
  embedTextFor,
  ensureTable,
  syncChunks,
  tableName,
  type ChunkRecord,
} from '../ingest/store.js';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    suffix: { type: 'string' },
    'max-tokens': { type: 'string' },
    'overlap-tokens': { type: 'string' },
  },
});

const options = {
  ...DEFAULT_CHUNK_OPTIONS,
  ...(args['max-tokens'] && { maxTokens: Number(args['max-tokens']) }),
  ...(args['overlap-tokens'] && { overlapTokens: Number(args['overlap-tokens']) }),
};

const started = performance.now();
const commit = await syncSource(DEFAULT_SOURCE_DIR, { offline: args.offline });
const { pages, missing } = listPages(DEFAULT_SOURCE_DIR);
console.log(`docs.nestjs.com @ ${commit.slice(0, 7)}: ${pages.length} pages`);
if (missing.length) console.warn(`  no markdown for routes: ${missing.join(', ')}`);

const records: ChunkRecord[] = pages.flatMap((page) => {
  const markdown = cleanMarkdown(readFileSync(join(DEFAULT_SOURCE_DIR, page.file), 'utf8'));
  return chunkMarkdown(markdown, options).map((chunk, position) => ({
    sourcePath: page.file,
    url: chunk.anchor ? `${page.url}#${chunk.anchor}` : page.url,
    headingPath: chunk.headingPath,
    position,
    content: chunk.content,
    tokens: chunk.tokens,
    embedText: embedTextFor(chunk.headingPath, chunk.content),
  }));
});

const sizes = records.map((r) => r.tokens).sort((a, b) => a - b);
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor((p / 100) * sizes.length))];
console.log(
  `${records.length} chunks (max ${options.maxTokens}, overlap ${options.overlapTokens} est. tokens); ` +
    `size p5/p50/p95/max: ${pct(5)}/${pct(50)}/${pct(95)}/${sizes.at(-1)}`,
);

if (args['dry-run']) {
  const sample = records.filter((_, i) => i % Math.ceil(records.length / 3) === 0);
  for (const r of sample) {
    console.log(`\n--- ${r.url} (${r.tokens} tok)\n${r.embedText.slice(0, 500)}`);
  }
  process.exit(0);
}

const config = loadConfig();
const embedder = createEmbedder(config);
const spec = getEmbeddingModel(config.EMBED_MODEL);
const hasPrefixes = Boolean(spec.queryPrefix || spec.documentPrefix);
const table = tableName(config.EMBED_MODEL, {
  noPrefix: hasPrefixes && !config.EMBED_USE_PREFIXES,
  suffix: args.suffix,
});

const pool = createPool(config);
try {
  await ensureTable(pool, table, embedder.dimensions);
  const stats = await syncChunks(
    pool,
    table,
    records,
    commit,
    (texts) => embedder.embed(texts, 'document'),
    {
      onProgress: (done, todo) =>
        process.stdout.write(`\r  ${embedder.id}: embedded ${done}/${todo}`),
    },
  );
  if (stats.embedded) process.stdout.write('\n');
  console.log(
    `${table}: ${stats.total} chunks — ${stats.embedded} embedded, ${stats.unchanged} unchanged, ` +
      `${stats.deleted} deleted (${((performance.now() - started) / 1000).toFixed(1)} s)`,
  );
} finally {
  await pool.end();
}

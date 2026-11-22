import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { ask, defaultMinScore } from './ask/ask.js';
import { pgvectorVersion } from './db.js';
import { tableForConfig } from './ingest/store.js';
import type { Embedder, Generator, Reranker } from './providers/index.js';
import { OllamaClient, sameModel } from './providers/ollama/client.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  embedder: Embedder;
  generator: Generator;
  /** `null` = vector order only (RERANK_PROVIDER=none). */
  reranker: Reranker | null;
}

/** Longer questions are not questions; it also bounds the reranker's work. */
const MAX_QUESTION_CHARS = 1000;

type Check = { ok: true; [key: string]: unknown } | { ok: false; error: string };

async function check(fn: () => Promise<Record<string, unknown>>): Promise<Check> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function buildServer({
  config,
  pool,
  embedder,
  generator,
  reranker,
}: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const table = tableForConfig(config);
  const minScore = config.ASK_MIN_SCORE ?? defaultMinScore(config.EMBED_MODEL, Boolean(reranker));

  /** Is everything the pipeline needs reachable? Not just "process is up". */
  app.get('/health', async (_req, reply) => {
    const ollama = new OllamaClient(config.OLLAMA_URL);
    const [db, models] = await Promise.all([
      check(async () => {
        const version = await pgvectorVersion(pool);
        if (!version) throw new Error('pgvector extension is not installed');
        return { pgvector: version };
      }),
      check(async () => {
        if (config.EMBED_PROVIDER !== 'ollama' && config.CHAT_PROVIDER !== 'ollama') return {};
        const pulled = await ollama.listModels();
        const missing = [embedder.model, generator.model].filter(
          (m) => !pulled.some((p) => sameModel(p, m)),
        );
        if (missing.length) throw new Error(`not pulled in Ollama: ${missing.join(', ')}`);
        return {};
      }),
    ]);

    const ok = db.ok && models.ok;
    return reply.code(ok ? 200 : 503).send({
      ok,
      db,
      models,
      embedder: { id: embedder.id, dimensions: embedder.dimensions },
      generator: { id: generator.id },
      reranker: reranker && { id: reranker.id },
    });
  });

  /** Answer from the indexed docs with citations, or "not in the docs" (see ask/ask.ts). */
  app.post<{ Body: { question: string } }>(
    '/ask',
    {
      schema: {
        body: {
          type: 'object',
          required: ['question'],
          properties: {
            question: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_QUESTION_CHARS,
              pattern: '\\S',
            },
          },
        },
      },
    },
    async (req, reply) => {
      const question = req.body.question.trim();
      try {
        const result = await ask(
          { pool, table, embedder, generator, reranker, minScore },
          question,
        );
        req.log.info(
          {
            answered: result.answered,
            reason: result.reason,
            topScore: result.retrieval.topScore,
            citations: result.citations.map((c) => c.n),
            timingsMs: result.timingsMs,
          },
          'ask',
        );
        return result;
      } catch (err) {
        // Database, Ollama or a malformed model answer: not the client's fault, not a crash either.
        req.log.error({ err }, 'ask failed');
        return reply.code(502).send({ error: 'Could not answer right now; see the API log.' });
      }
    },
  );

  return app;
}

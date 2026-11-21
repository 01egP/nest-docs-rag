import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { pgvectorVersion } from './db.js';
import type { Embedder, Generator } from './providers/index.js';
import { OllamaClient, sameModel } from './providers/ollama/client.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  embedder: Embedder;
  generator: Generator;
}

type Check = { ok: true; [key: string]: unknown } | { ok: false; error: string };

async function check(fn: () => Promise<Record<string, unknown>>): Promise<Check> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function buildServer({ config, pool, embedder, generator }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

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
    });
  });

  return app;
}

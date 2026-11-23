import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { ask, askStream, defaultMinScore, type AskResult } from './ask/ask.js';
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
const ASK_FAILED = 'Could not answer right now; see the API log.';

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

  const askDeps = { pool, table, embedder, generator, reranker, minScore };
  const askBody = {
    body: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION_CHARS, pattern: '\\S' },
      },
    },
  };
  type AskRequest = { Body: { question: string } };
  const logResult = (log: FastifyBaseLogger, result: AskResult) =>
    log.info(
      {
        answered: result.answered,
        reason: result.reason,
        topScore: result.retrieval.topScore,
        citations: result.citations.map((c) => c.n),
        timingsMs: result.timingsMs,
      },
      'ask',
    );

  /** Answer from the indexed docs with citations, or "not in the docs" (see ask/ask.ts). */
  app.post<AskRequest>('/ask', { schema: askBody }, async (req, reply) => {
    try {
      const result = await ask(askDeps, req.body.question.trim());
      logResult(req.log, result);
      return result;
    } catch (err) {
      // Database, Ollama or a malformed model answer: not the client's fault, not a crash either.
      req.log.error({ err }, 'ask failed');
      return reply.code(502).send({ error: ASK_FAILED });
    }
  });

  /**
   * The same answer as Server-Sent Events, so a page can show the sources after search and the text
   * while the model writes it: `retrieval`, `delta`…, `done` (the `POST /ask` body), or `error`.
   * POST because the question is a body; read it with fetch, not EventSource (GET only).
   */
  app.post<AskRequest>('/ask/stream', { schema: askBody }, async (req, reply) => {
    const question = req.body.question.trim();
    // The reader left (tab closed, request cancelled): stop generating instead of burning the CPU.
    const abort = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) abort.abort();
    });

    reply.hijack(); // Fastify won't serialize a reply; the raw response is written by hand below
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // no buffering if a proxy (nginx) ever sits in front
    });
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    reply.raw.write(': searching\n\n'); // headers out now; search with reranking takes seconds

    try {
      for await (const event of askStream(askDeps, question, abort.signal)) {
        if (abort.signal.aborted) break;
        if (event.type === 'retrieval') {
          send('retrieval', { retrieval: event.retrieval, timingsMs: event.timingsMs });
        } else if (event.type === 'delta') {
          send('delta', { text: event.text });
        } else {
          logResult(req.log, event.result);
          send('done', event.result);
        }
      }
    } catch (err) {
      if (abort.signal.aborted) {
        req.log.info('ask stream cancelled by the client');
      } else {
        req.log.error({ err }, 'ask stream failed');
        send('error', { error: ASK_FAILED });
      }
    } finally {
      reply.raw.end();
    }
  });

  return app;
}

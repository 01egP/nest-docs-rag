import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createEmbedder, createGenerator, createReranker } from './providers/index.js';
import { buildServer } from './server.js';

const config = loadConfig();
const pool = createPool(config);
const reranker = createReranker(config);
const app = buildServer({
  config,
  pool,
  embedder: createEmbedder(config),
  generator: createGenerator(config),
  reranker,
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.API_PORT, host: '127.0.0.1' });

// Load the reranker model now rather than on the first /ask (a few seconds; a download the first time).
if (reranker) {
  const t = performance.now();
  reranker
    .score('warm-up', ['warm-up'])
    .then(() =>
      app.log.info(`reranker ${reranker.id} ready in ${Math.round(performance.now() - t)} ms`),
    )
    .catch((err: unknown) => app.log.error({ err }, 'reranker warm-up failed'));
}

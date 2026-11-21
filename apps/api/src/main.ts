import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createEmbedder, createGenerator } from './providers/index.js';
import { buildServer } from './server.js';

const config = loadConfig();
const pool = createPool(config);
const app = buildServer({
  config,
  pool,
  embedder: createEmbedder(config),
  generator: createGenerator(config),
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.API_PORT, host: '127.0.0.1' });

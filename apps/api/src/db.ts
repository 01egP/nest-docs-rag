import pg from 'pg';
import pgvector from 'pgvector/pg';
import type { Config } from './config.js';

export function createPool(config: Config): pg.Pool {
  const pool = new pg.Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    max: 5,
  });
  // Teach node-postgres to send/receive the `vector` type as number[].
  pool.on('connect', (client) => pgvector.registerTypes(client));
  return pool;
}

/** Version of the pgvector extension, or null if it is not installed in this database. */
export async function pgvectorVersion(pool: pg.Pool): Promise<string | null> {
  const { rows } = await pool.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  return rows[0]?.extversion ?? null;
}

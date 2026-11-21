import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  db: { ok: boolean; pgvector?: string; error?: string };
  models: { ok: boolean; error?: string };
  embedder: { id: string; dimensions: number };
  generator: { id: string };
}

// Placeholder page: shows whether the backend is wired up. The question/answer UI comes later.
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '3rem auto' }}>
      <h1>Ask the NestJS docs</h1>
      {error && <p>API unreachable: {error}</p>}
      {!health && !error && <p>Checking backend…</p>}
      {health && (
        <ul>
          <li>Database: {health.db.ok ? `ok, pgvector ${health.db.pgvector}` : health.db.error}</li>
          <li>Models: {health.models.ok ? 'ok' : health.models.error}</li>
          <li>
            Embedder: {health.embedder.id} ({health.embedder.dimensions} dims)
          </li>
          <li>Generator: {health.generator.id}</li>
        </ul>
      )}
    </main>
  );
}

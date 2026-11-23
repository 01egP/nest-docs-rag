import { useEffect, useState } from 'react';
import type { Health } from '../api/types';

/** One line: is the backend wired up, and which models answer. */
export function HealthBar() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      // 503 still has the JSON body that says what is down
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(String(err));
      });
    return () => controller.abort();
  }, []);

  if (error)
    return (
      <p className="health bad">
        API unreachable — is <code>npm run dev:api</code> running?
      </p>
    );
  if (!health) return <p className="health">Checking backend…</p>;

  const { db, models, embedder, generator, reranker } = health;
  return (
    <p className={health.ok ? 'health' : 'health bad'}>
      <span title={db.error}>DB {db.ok ? '✓' : '✗'}</span>
      <span title={models.error}>Ollama {models.ok ? '✓' : '✗'}</span>
      <span>embed {embedder.id}</span>
      {reranker && <span>rerank {reranker.id.split('/').pop()}</span>}
      <span>answer {generator.id}</span>
    </p>
  );
}

import { useEffect, useState } from 'react';

/** Seconds since `startedAt` (a `performance.now()` value), ticking while mounted. */
export function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="elapsed">{seconds(now - startedAt)}</span>;
}

export const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

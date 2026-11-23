import type { Retrieval } from '../api/types';

interface Props {
  retrieval: Retrieval;
  /** After `done`: the sources the answer cites; the rest are dimmed. */
  cited?: ReadonlySet<number>;
}

const shortUrl = (url: string) => url.replace(/^https?:\/\/docs\.nestjs\.com/, '');

export function Sources({ retrieval, cited }: Props) {
  const { sources, reranked, minScore } = retrieval;
  if (!sources.length) return null;
  return (
    <section className="sources" aria-label="Sources">
      <h2>
        Sources{' '}
        <small>
          {reranked ? 'reranker score' : 'cosine similarity'}, threshold {minScore}
        </small>
      </h2>
      <ol>
        {sources.map((s) => (
          <li
            key={s.n}
            id={`source-${s.n}`}
            className={cited && !cited.has(s.n) ? 'source dimmed' : 'source'}
          >
            <span className="source-n">[{s.n}]</span>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title || shortUrl(s.url)}
            </a>
            <span className="source-url">{shortUrl(s.url)}</span>
            <span className="source-score" title="score">
              {s.score.toFixed(3)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

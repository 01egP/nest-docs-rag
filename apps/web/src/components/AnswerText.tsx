import { parseAnswer, type Inline } from '../ask/answer-text';

interface Props {
  text: string;
  /** Source numbers that exist; `[n]` becomes a link only for these. Omit while streaming. */
  linkable?: ReadonlySet<number>;
  streaming?: boolean;
}

export function AnswerText({ text, linkable, streaming }: Props) {
  const blocks = parseAnswer(text);
  return (
    <div className={streaming ? 'answer-text streaming' : 'answer-text'}>
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <pre key={i} data-lang={block.lang || undefined}>
            <code>{block.text}</code>
          </pre>
        ) : (
          <p key={i}>
            {block.parts.map((part, j) => (
              <InlinePart key={j} part={part} linkable={linkable} />
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function InlinePart({ part, linkable }: { part: Inline; linkable?: ReadonlySet<number> }) {
  if (part.kind === 'code') return <code>{part.text}</code>;
  if (part.kind === 'text') return <>{part.text}</>;
  if (!linkable?.has(part.n)) return <span className="cite">[{part.n}]</span>;
  return (
    <a className="cite" href={`#source-${part.n}`}>
      [{part.n}]
    </a>
  );
}

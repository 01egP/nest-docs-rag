import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { AskResult, NotAnsweredReason } from './api/types';
import { isBusy, type AskState } from './ask/state';
import { useAskStream } from './ask/useAskStream';
import { AnswerText } from './components/AnswerText';
import { Elapsed, seconds } from './components/Elapsed';
import { HealthBar } from './components/HealthBar';
import { Sources } from './components/Sources';

const MAX_QUESTION_CHARS = 1000; // the API's limit (apps/api/src/server.ts)

const EXAMPLES = [
  'How do I make a guard global?',
  'Как валидировать тело запроса с помощью pipes?',
  'How do I set up lazy-loaded routes in Angular?',
];

export function App() {
  const { state, ask, stop } = useAskStream();
  const [question, setQuestion] = useState('');
  const busy = isBusy(state);

  const submit = (q: string) => {
    if (q.trim()) void ask(q.trim());
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(question);
  };
  // Enter asks, Shift+Enter is a new line
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(question);
    }
  };

  return (
    <main>
      <header>
        <h1>Ask the NestJS docs</h1>
        <HealthBar />
      </header>

      <form onSubmit={onSubmit} className="ask-form">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about NestJS — answers come only from the official docs"
          maxLength={MAX_QUESTION_CHARS}
          rows={3}
          autoFocus
          aria-label="Question"
        />
        <div className="form-row">
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="example"
                onClick={() => {
                  setQuestion(ex);
                  submit(ex);
                }}
              >
                {ex}
              </button>
            ))}
          </div>
          {/* Different keys: reusing one <button> would turn it into type=submit during the Stop
              click, and the browser would then submit the form — asking the question again. */}
          {busy ? (
            <button key="stop" type="button" onClick={stop} className="stop">
              Stop
            </button>
          ) : (
            <button key="ask" type="submit" disabled={!question.trim()}>
              Ask
            </button>
          )}
        </div>
      </form>

      <Result state={state} />
    </main>
  );
}

function Result({ state }: { state: AskState }) {
  switch (state.phase) {
    case 'idle':
      return null;

    case 'searching':
      return (
        <Status>
          Searching the docs and reranking… <Elapsed startedAt={state.startedAt} />
        </Status>
      );

    case 'answering':
      return (
        <>
          <Status>
            {state.text ? 'Writing the answer…' : 'Sources found, the model is reading them…'}{' '}
            <Elapsed startedAt={state.startedAt} />
            <small>search {seconds(state.searchMs)}</small>
          </Status>
          {state.text && (
            <section className="answer">
              <AnswerText text={state.text} streaming />
            </section>
          )}
          <Sources retrieval={state.retrieval} />
        </>
      );

    case 'done':
      return <Done result={state.result} />;

    case 'error':
    case 'cancelled':
      return (
        <>
          {state.phase === 'error' ? (
            <p className="notice error" role="alert">
              {state.message}
            </p>
          ) : (
            <p className="notice">Stopped.</p>
          )}
          {state.text && (
            <section className="answer partial">
              <AnswerText text={state.text} />
            </section>
          )}
          {state.retrieval && <Sources retrieval={state.retrieval} />}
        </>
      );
  }
}

const REASONS: Record<NotAnsweredReason, string> = {
  below_threshold: 'nothing in the docs scored above the threshold, so the model was not asked',
  model_declined: 'the model found no answer in the retrieved sources',
  no_citations: 'the model answered without citing any source, so the answer was dropped',
};

function Done({ result }: { result: AskResult }) {
  const cited = new Set(result.citations.map((c) => c.n));
  const { generator, timingsMs } = result;
  return (
    <>
      {result.answered ? (
        <section className="answer">
          <AnswerText text={result.answer} linkable={cited} />
        </section>
      ) : (
        <section className="answer declined">
          <p>{result.answer}</p>
          {result.reason && <small>Why: {REASONS[result.reason]}.</small>}
        </section>
      )}
      <p className="meta">
        {seconds(timingsMs.total)} total · search {seconds(timingsMs.search)}
        {timingsMs.generate !== undefined && <> · answer {seconds(timingsMs.generate)}</>}
        {generator && <> · {generator.id}</>}
        {generator?.inputTokens !== undefined && (
          <>
            {' '}
            · {generator.inputTokens} → {generator.outputTokens ?? '?'} tokens
          </>
        )}
      </p>
      <Sources retrieval={result.retrieval} cited={result.answered ? cited : undefined} />
    </>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p className="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      {children}
    </p>
  );
}

import { describe, expect, it } from 'vitest';
import type { AskResult, Retrieval } from '../api/types';
import { askReducer, initialState, type AskAction, type AskState } from './state';

const retrieval: Retrieval = {
  table: 'chunks_bge_m3',
  reranked: true,
  topScore: 0.9,
  minScore: 0.1,
  sources: [{ n: 1, url: 'https://docs.nestjs.com/guards', title: 'Guards', score: 0.9 }],
};
const result: AskResult = {
  answered: true,
  answer: 'Use `useGlobalGuards()` [1].',
  citations: [{ ...retrieval.sources[0]!, content: '…' }],
  retrieval,
  timingsMs: { search: 10, generate: 20, total: 30 },
};

const run = (...actions: AskAction[]) => actions.reduce<AskState>(askReducer, initialState);
const start: AskAction = { type: 'start', question: 'q', at: 0 };
const ev = (event: Extract<AskAction, { type: 'event' }>['event']): AskAction => ({
  type: 'event',
  event,
});
const found = ev({ type: 'retrieval', retrieval, timingsMs: { search: 10 } });

describe('askReducer', () => {
  it('goes searching → answering → done, appending deltas on the way', () => {
    expect(run(start)).toMatchObject({ phase: 'searching', question: 'q' });
    expect(run(start, found)).toMatchObject({ phase: 'answering', searchMs: 10, text: '' });
    expect(
      run(start, found, ev({ type: 'delta', text: 'Use ' }), ev({ type: 'delta', text: 'it [7]' })),
    ).toMatchObject({ phase: 'answering', text: 'Use it [7]' });
  });

  it('replaces the streamed text with the final answer', () => {
    const state = run(
      start,
      found,
      ev({ type: 'delta', text: 'raw [7]' }),
      ev({ type: 'done', result }),
    );
    expect(state).toEqual({ phase: 'done', question: 'q', startedAt: 0, result });
  });

  it('keeps the sources and partial text on error and on stop', () => {
    const partial = [start, found, ev({ type: 'delta', text: 'Use' })];
    expect(run(...partial, ev({ type: 'error', error: 'boom' }))).toEqual({
      phase: 'error',
      question: 'q',
      message: 'boom',
      retrieval,
      text: 'Use',
    });
    expect(run(...partial, { type: 'cancel' })).toEqual({
      phase: 'cancelled',
      question: 'q',
      retrieval,
      text: 'Use',
    });
    expect(run(start, { type: 'fail', message: 'Could not reach the API.' })).toEqual({
      phase: 'error',
      question: 'q',
      message: 'Could not reach the API.',
    });
  });

  it('ignores events once the question is finished or stopped', () => {
    const stopped = run(start, found, { type: 'cancel' });
    expect(askReducer(stopped, ev({ type: 'delta', text: 'late' }))).toBe(stopped);
    expect(askReducer(stopped, { type: 'cancel' })).toBe(stopped);
    expect(run({ type: 'cancel' })).toBe(initialState);
  });

  it('ignores a delta before retrieval', () => {
    const searching = run(start);
    expect(askReducer(searching, ev({ type: 'delta', text: 'x' }))).toBe(searching);
  });

  it('starts over on a new question', () => {
    expect(run(start, found, ev({ type: 'done', result }), { ...start, question: 'next' })).toEqual(
      {
        phase: 'searching',
        question: 'next',
        startedAt: 0,
      },
    );
  });
});

import { describe, expect, it } from 'vitest';
import { AnswerDeltas, readPartialAnswer } from './partial-answer.js';

const FULL = JSON.stringify({
  answerable: true,
  answer: 'Use "APP_GUARD" [2].\nOr app.useGlobalGuards() — é [1].',
  citations: [2, 1],
});

describe('readPartialAnswer', () => {
  it('reads nothing before the fields are written', () => {
    expect(readPartialAnswer('')).toEqual({ answerable: undefined, answer: '' });
    expect(readPartialAnswer('{"answerable": tr')).toEqual({ answerable: undefined, answer: '' });
  });

  it('does not take "answerable" for the start of "answer"', () => {
    expect(readPartialAnswer('{"answerable": true, "ans')).toEqual({
      answerable: true,
      answer: '',
    });
  });

  it('decodes the complete prefix and stops before an unfinished escape', () => {
    expect(readPartialAnswer('{"answerable":true,"answer":"Use \\"APP')).toMatchObject({
      answer: 'Use "APP',
    });
    expect(readPartialAnswer('{"answerable":true,"answer":"a\\')).toMatchObject({ answer: 'a' });
    expect(readPartialAnswer('{"answerable":true,"answer":"a\\u00')).toMatchObject({
      answer: 'a',
    });
    expect(readPartialAnswer('{"answerable":true,"answer":"a\\u00e9')).toMatchObject({
      answer: 'aé',
    });
  });

  it('reads the whole answer from the finished JSON', () => {
    expect(readPartialAnswer(FULL)).toEqual({
      answerable: true,
      answer: JSON.parse(FULL).answer,
    });
  });
});

describe('AnswerDeltas', () => {
  /** Feeds the JSON in pieces of `size` characters, the way tokens arrive. */
  const feed = (json: string, size: number) => {
    const deltas = new AnswerDeltas();
    const out: string[] = [];
    for (let i = 0; i < json.length; i += size) {
      const d = deltas.push(json.slice(i, i + size));
      if (d) out.push(d);
    }
    return out;
  };

  it.each([1, 2, 3, 7, 1000])('adds up to the full answer in pieces of %i', (size) => {
    expect(feed(FULL, size).join('')).toBe(JSON.parse(FULL).answer);
  });

  it('sends nothing for a refusal', () => {
    const json = JSON.stringify({ answerable: false, answer: 'Angular is…', citations: [] });
    expect(feed(json, 3)).toEqual([]);
  });

  it('waits for "answerable" if the model writes the answer first', () => {
    const json = '{"answer":"Guards [1].","answerable":true,"citations":[1]}';
    expect(feed(json, 4).join('')).toBe('Guards [1].');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Embedder, GenerateRequest, Generator } from '../providers/types.js';
import {
  ask,
  buildPrompt,
  defaultMinScore,
  notInDocsMessage,
  parseAnswer,
  RERANKER_MIN_SCORE,
  type AskDeps,
} from './ask.js';

const D = 'https://docs.nestjs.com';

describe('parseAnswer', () => {
  it('keeps valid citations and adds markers the model forgot to list', () => {
    const text = JSON.stringify({
      answerable: true,
      answer: 'Use APP_GUARD [2]. Or app.useGlobalGuards() [1].',
      citations: [2],
    });
    expect(parseAnswer(text, 6)).toEqual({
      answerable: true,
      answer: 'Use APP_GUARD [2]. Or app.useGlobalGuards() [1].',
      citations: [2, 1],
    });
  });

  it('drops numbers that point at no source, in the list and in the text', () => {
    const text = JSON.stringify({
      answerable: true,
      answer: 'Guards run after middleware [7] and before pipes [3].',
      citations: [0, 3, 7, 3, 1.5],
    });
    expect(parseAnswer(text, 6)).toEqual({
      answerable: true,
      answer: 'Guards run after middleware and before pipes [3].',
      citations: [3],
    });
  });

  it('rejects text that is not the expected JSON', () => {
    expect(() => parseAnswer('Sure! Guards are…', 6)).toThrow();
    expect(() => parseAnswer('{"answer": "x"}', 6)).toThrow(/Unexpected answer shape/);
  });
});

describe('buildPrompt', () => {
  it('numbers the sources from 1 with their heading path and leaves URLs out', () => {
    const [system, user] = buildPrompt('How?', [
      {
        id: 1,
        url: `${D}/guards#binding-guards`,
        headingPath: ['Guards', 'Binding guards'],
        content: 'A',
        score: 0.9,
      },
      { id: 2, url: `${D}/pipes`, headingPath: ['Pipes'], content: 'B', score: 0.8 },
    ]);
    expect(system!.role).toBe('system');
    expect(user!.content).toBe(
      'Sources:\n\n[1] Guards › Binding guards\nA\n\n[2] Pipes\nB\n\nQuestion: How?',
    );
    expect(user!.content).not.toContain(D);
  });
});

describe('defaultMinScore', () => {
  it('uses the reranker threshold when reranking, else the embedding model one', () => {
    expect(defaultMinScore('bge-m3', true)).toBe(RERANKER_MIN_SCORE);
    expect(defaultMinScore('bge-m3:latest', false)).toBe(0.5);
    expect(defaultMinScore('nomic-embed-text', false)).toBe(0);
    expect(() => defaultMinScore('unknown-model', false)).toThrow(/Unknown embedding model/);
  });
});

describe('notInDocsMessage', () => {
  it('answers in the language of the question', () => {
    expect(notInDocsMessage('Как приготовить борщ?')).toMatch(/документации/);
    expect(notInDocsMessage('How do I cook borscht?')).toMatch(/docs/);
  });
});

// --- ask(): fakes for the database and the models ---

const rows = [
  {
    id: '1',
    url: `${D}/guards#binding-guards`,
    heading_path: ['Guards', 'Binding guards'],
    content: 'Guards A',
    distance: 0.3,
  },
  {
    id: '2',
    url: `${D}/guards#global-guards`,
    heading_path: ['Guards', 'Global guards'],
    content: 'Guards B',
    distance: 0.35,
  },
  { id: '3', url: `${D}/pipes`, heading_path: ['Pipes'], content: 'Pipes', distance: 0.4 },
];

function deps(modelAnswer: object, overrides: Partial<AskDeps> = {}) {
  const generate = vi.fn(async (_req: GenerateRequest) => ({
    text: JSON.stringify(modelAnswer),
    model: 'fake',
    usage: { inputTokens: 100, outputTokens: 20 },
  }));
  const d: AskDeps = {
    pool: { query: vi.fn(async () => ({ rows })) } as unknown as AskDeps['pool'],
    table: 'chunks_bge_m3',
    embedder: {
      id: 'fake:e',
      model: 'e',
      dimensions: 3,
      embed: async () => [[1, 0, 0]],
    } as Embedder,
    generator: { id: 'fake:g', model: 'g', generate } as Generator,
    reranker: null,
    minScore: 0.5,
    ...overrides,
  };
  return { d, generate };
}

describe('ask', () => {
  it('answers with the cited chunks, URLs taken from the search, not the model', async () => {
    const { d, generate } = deps({
      answerable: true,
      answer: 'Use APP_GUARD [2].',
      citations: [2],
    });
    const r = await ask(d, 'How do I apply a guard globally?');

    expect(generate).toHaveBeenCalledOnce();
    expect(r.answered).toBe(true);
    expect(r.answer).toBe('Use APP_GUARD [2].');
    expect(r.citations).toEqual([
      {
        n: 2,
        url: `${D}/guards#global-guards`,
        title: 'Guards › Global guards',
        content: 'Guards B',
        score: 0.65,
      },
    ]);
    expect(r.retrieval.sources.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(r.generator).toEqual({ id: 'fake:g', inputTokens: 100, outputTokens: 20 });
  });

  it('refuses below the threshold without calling the model', async () => {
    const { d, generate } = deps({}, { minScore: 0.8 });
    const r = await ask(d, 'Как приготовить борщ?');

    expect(generate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ answered: false, reason: 'below_threshold', citations: [] });
    expect(r.answer).toMatch(/документации/);
  });

  it('refuses when the model says the sources do not cover the question', async () => {
    const { d } = deps({ answerable: false, answer: '', citations: [] });
    const r = await ask(d, 'How do I configure lazy-loaded routes in Angular?');
    expect(r).toMatchObject({ answered: false, reason: 'model_declined' });
  });

  it('refuses an answer that cites no real source', async () => {
    const { d } = deps({ answerable: true, answer: 'Just use Express.', citations: [9] });
    const r = await ask(d, 'How do I apply a guard globally?');
    expect(r).toMatchObject({ answered: false, reason: 'no_citations', citations: [] });
  });
});

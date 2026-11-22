import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { loadConfig } from './config.js';
import type { Embedder, Generator } from './providers/index.js';
import { buildServer } from './server.js';

const config = loadConfig({ DB_USER: 'test', DB_PASSWORD: 'test', LOG_LEVEL: 'fatal' });

function server(generate: Generator['generate']) {
  const pool = {
    query: vi.fn(async () => ({
      rows: [
        {
          id: '1',
          url: 'https://docs.nestjs.com/guards',
          heading_path: ['Guards'],
          content: 'Guards…',
          distance: 0.2,
        },
      ],
    })),
  } as unknown as pg.Pool;
  const embedder = {
    id: 'fake:e',
    model: 'bge-m3',
    dimensions: 3,
    embed: async () => [[1, 0, 0]],
  } as Embedder;
  const generator = { id: 'fake:g', model: 'g', generate } as Generator;
  return buildServer({ config, pool, embedder, generator, reranker: null });
}

const post = (app: ReturnType<typeof server>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/ask', payload: payload as object });

describe('POST /ask', () => {
  it('returns the answer with citations', async () => {
    const app = server(async () => ({
      text: JSON.stringify({ answerable: true, answer: 'Guards decide [1].', citations: [1] }),
      model: 'g',
    }));
    const res = await post(app, { question: '  How do guards work? ' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ answered: true, answer: 'Guards decide [1].' });
    expect(body.citations[0]).toMatchObject({ n: 1, url: 'https://docs.nestjs.com/guards' });
  });

  it.each([{}, { question: '' }, { question: '   ' }, { question: 'x'.repeat(1001) }])(
    'rejects a bad body %j with 400',
    async (payload) => {
      const res = await post(server(vi.fn()), payload);
      expect(res.statusCode).toBe(400);
    },
  );

  it('answers 502 when the model fails, without leaking the error', async () => {
    const app = server(async () => {
      throw new Error('Ollama /api/chat: HTTP 500 secret detail');
    });
    const res = await post(app, { question: 'How do guards work?' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('secret detail');
  });
});

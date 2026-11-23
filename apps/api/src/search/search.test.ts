import { describe, expect, it } from 'vitest';
import type { Reranker } from '../providers/index.js';
import { diversify, rerankHits, type SearchHit } from './search.js';

const D = 'https://docs.nestjs.com';
let nextId = 1;
const hit = (url: string, score: number): SearchHit => ({
  id: nextId++,
  url: `${D}/${url}`,
  headingPath: [],
  content: '',
  score,
});

const pool = [
  hit('security/authentication#rate-limit-sign-in', 0.7),
  hit('security/authentication#rate-limit-sign-in', 0.69),
  hit('tutorials/rest-api-jwt-authentication#rate-limit-sign-in', 0.68),
  hit('security/authentication#implementing-passport', 0.67),
  hit('security/rate-limiting', 0.66),
  hit('security/rate-limiting#multiple-throttler-definitions', 0.65),
];
const urls = (hs: SearchHit[]) => hs.map((h) => h.url.slice(D.length + 1));

describe('diversify', () => {
  it('keeps one chunk per section by default, in score order', () => {
    expect(urls(diversify(pool, 6))).toEqual([
      'security/authentication#rate-limit-sign-in',
      'tutorials/rest-api-jwt-authentication#rate-limit-sign-in',
      'security/authentication#implementing-passport',
      'security/rate-limiting',
      'security/rate-limiting#multiple-throttler-definitions',
    ]);
  });

  it('can also cap chunks per page', () => {
    expect(urls(diversify(pool, 6, { maxPerPage: 1 }))).toEqual([
      'security/authentication#rate-limit-sign-in',
      'tutorials/rest-api-jwt-authentication#rate-limit-sign-in',
      'security/rate-limiting',
    ]);
  });

  it('stops at k', () => {
    expect(diversify(pool, 2)).toHaveLength(2);
  });

  it('returns the raw order with no limits', () => {
    expect(diversify(pool, 6, { maxPerSection: Infinity })).toEqual(pool);
  });
});

describe('rerankHits', () => {
  // Fake cross-encoder: relevance = how often the query word occurs in the text.
  const reranker: Reranker = {
    id: 'fake',
    model: 'fake',
    score: async (query, docs) => docs.map((d) => d.split(query).length - 1),
  };
  const h = (url: string, content: string, score: number): SearchHit => ({
    ...hit(url, score),
    content,
  });

  it('re-sorts by the reranker score and keeps the cosine as vectorScore', async () => {
    const out = await rerankHits(reranker, 'throttle', [
      h('a', 'limits', 0.7),
      h('b', 'throttle throttle', 0.6),
      h('c', 'throttle', 0.5),
    ]);
    expect(urls(out)).toEqual(['b', 'c', 'a']);
    expect(out.map((x) => [x.score, x.vectorScore])).toEqual([
      [2, 0.6],
      [1, 0.5],
      [0, 0.7],
    ]);
  });

  it('shows the reranker the heading chain with the chunk', async () => {
    const seen: string[] = [];
    const spy: Reranker = {
      ...reranker,
      score: async (_q, d) => (seen.push(...d), d.map(() => 0)),
    };
    await rerankHits(spy, 'q', [{ ...h('a', 'body', 0.5), headingPath: ['Guards', 'Binding'] }]);
    expect(seen).toEqual(['Guards > Binding\n\nbody']);

    seen.length = 0;
    await rerankHits(
      spy,
      'q',
      [{ ...h('a', 'body', 0.5), headingPath: ['Guards', 'Binding'] }],
      false,
    );
    expect(seen).toEqual(['body']);
  });
});

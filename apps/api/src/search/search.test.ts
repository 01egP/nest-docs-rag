import { describe, expect, it } from 'vitest';
import { diversify, type SearchHit } from './search.js';

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

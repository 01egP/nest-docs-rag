import { describe, expect, it } from 'vitest';
import { firstHitRank, matches, suggestThreshold, summarizeRanks } from './metrics.js';

const G = 'https://docs.nestjs.com/guards';

describe('matches', () => {
  it('ignores the anchor at page level', () => {
    expect(matches(`${G}#execution-context`, `${G}#binding-guards`, 'page')).toBe(true);
    expect(matches(`${G}#execution-context`, `${G}#binding-guards`, 'section')).toBe(false);
  });

  it('treats an expected URL without an anchor as the whole page', () => {
    expect(matches(`${G}#binding-guards`, G, 'section')).toBe(true);
  });

  it('does not match a page that merely shares a prefix', () => {
    expect(matches('https://docs.nestjs.com/guards-extra', G, 'page')).toBe(false);
  });
});

describe('firstHitRank', () => {
  const retrieved = [
    'https://docs.nestjs.com/pipes',
    `${G}#execution-context`,
    `${G}#binding-guards`,
  ];

  it('is the 1-based position of the first match against any expected URL', () => {
    expect(firstHitRank(retrieved, [`${G}#binding-guards`], 'page')).toBe(2);
    expect(firstHitRank(retrieved, [`${G}#binding-guards`], 'section')).toBe(3);
  });

  it('is null when nothing matches', () => {
    expect(firstHitRank(retrieved, ['https://docs.nestjs.com/modules'], 'page')).toBeNull();
  });
});

describe('summarizeRanks', () => {
  it('computes hit@k and MRR', () => {
    const s = summarizeRanks([1, 2, null, 6], [1, 3, 6]);
    expect(s.hitAt).toEqual({ 1: 0.25, 3: 0.5, 6: 0.75 });
    expect(s.mrr).toBeCloseTo((1 + 0.5 + 0 + 1 / 6) / 4);
  });
});

describe('suggestThreshold', () => {
  it('takes the middle of the gap when the groups separate', () => {
    const t = suggestThreshold([0.7, 0.62, 0.8], [0.4, 0.5])!;
    expect(t.separable).toBe(true);
    expect(t.threshold).toBeCloseTo(0.56);
    expect(t.errors).toBe(0);
  });

  it('minimises misclassified questions when the groups overlap', () => {
    const t = suggestThreshold([0.7, 0.45, 0.8], [0.4, 0.5])!;
    expect(t.separable).toBe(false);
    expect(t.errors).toBe(1);
  });

  it('needs both groups', () => {
    expect(suggestThreshold([0.7], [])).toBeNull();
  });
});

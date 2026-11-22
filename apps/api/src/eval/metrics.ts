/**
 * Retrieval metrics for the eval set. Pure functions, no database or model involved.
 *
 * Two levels of "hit":
 *   page    — a retrieved chunk is on an expected page (anchor ignored);
 *   section — a retrieved chunk is in an expected section (anchor must match).
 * An expected URL without an anchor means "anywhere on that page" at both levels.
 */

export type QuestionKind = 'docs' | 'off-topic' | 'tricky';

export interface EvalQuestion {
  id: string;
  kind: QuestionKind;
  lang: string;
  question: string;
  /** Acceptable sources; empty = the right answer is "not in the docs". */
  expected: string[];
  note?: string;
}

export type Level = 'page' | 'section';

const page = (url: string) => url.split('#')[0]!;

export function matches(retrieved: string, expected: string, level: Level): boolean {
  if (!expected.includes('#') || level === 'page') return page(retrieved) === page(expected);
  return retrieved === expected;
}

/** 1-based rank of the first retrieved URL that matches any expected one; null if none does. */
export function firstHitRank(retrieved: string[], expected: string[], level: Level): number | null {
  const i = retrieved.findIndex((url) => expected.some((e) => matches(url, e, level)));
  return i === -1 ? null : i + 1;
}

export interface QuestionResult {
  id: string;
  kind: QuestionKind;
  /** Similarity of the best chunk — what the "not in the docs" threshold is applied to. */
  topScore: number;
  pageRank: number | null;
  sectionRank: number | null;
}

export interface RankSummary {
  n: number;
  hitAt: Record<number, number>;
  /** Mean reciprocal rank: 1 = always first, 0 = never found within k. */
  mrr: number;
}

export function summarizeRanks(ranks: (number | null)[], ks: number[]): RankSummary {
  const n = ranks.length;
  const hitAt = Object.fromEntries(
    ks.map((k) => [k, n ? ranks.filter((r) => r !== null && r <= k).length / n : 0]),
  );
  const mrr = n ? ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / n : 0;
  return { n, hitAt, mrr };
}

export interface ThresholdSuggestion {
  /** Lowest top score among questions the docs can answer. */
  minAnswerable: number;
  /** Highest top score among off-topic questions. */
  maxOffTopic: number;
  /** True if one threshold separates the two groups on this set. */
  separable: boolean;
  /** Midpoint of the gap if separable; otherwise the cut that misclassifies the fewest questions. */
  threshold: number;
  /** Questions on the wrong side of `threshold`. */
  errors: number;
}

/**
 * Pick a "not in the docs" threshold from top scores (ADR-002). With an eval set this small it is
 * a starting point to sanity-check, not a tuned value.
 */
export function suggestThreshold(
  answerable: number[],
  offTopic: number[],
): ThresholdSuggestion | null {
  if (!answerable.length || !offTopic.length) return null;
  const minAnswerable = Math.min(...answerable);
  const maxOffTopic = Math.max(...offTopic);
  const errorsAt = (t: number) =>
    answerable.filter((s) => s < t).length + offTopic.filter((s) => s >= t).length;

  if (minAnswerable > maxOffTopic) {
    const threshold = (minAnswerable + maxOffTopic) / 2;
    return { minAnswerable, maxOffTopic, separable: true, threshold, errors: 0 };
  }

  // Overlap: try each observed score as the cut and keep the one with the fewest errors.
  let best = { threshold: minAnswerable, errors: errorsAt(minAnswerable) };
  for (const t of [...answerable, ...offTopic]) {
    const errors = errorsAt(t);
    if (errors < best.errors) best = { threshold: t, errors };
  }
  return { minAnswerable, maxOffTopic, separable: false, ...best };
}

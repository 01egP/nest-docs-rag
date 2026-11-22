/**
 * Retrieval eval: embed each question of `eval/questions.json`, search the index, score hit@k.
 * Uses the same table as ingest for the configured model (EMBED_MODEL, EMBED_USE_PREFIXES, --suffix).
 *   npm run eval                        current model, default index
 *   npm run eval -- --suffix c400       an experiment index built with the same --suffix
 *   npm run eval -- --verbose           also print the top chunks of every question
 *   npm run eval -- --no-dedupe         raw nearest neighbours (default: one chunk per section)
 *   npm run eval -- --per-page 2        also cap chunks per page
 *   npm run eval -- --report            Markdown table of all saved runs (for the README)
 * Each run is saved to reports/eval/<table>[__<variant>].json; the variant names non-default
 * diversification (`raw`, `p2`, ...).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { createEmbedder } from '../providers/index.js';
import { tableForConfig } from '../ingest/store.js';
import { DEFAULT_TOP_K, searchChunks } from '../search/search.js';
import {
  firstHitRank,
  suggestThreshold,
  summarizeRanks,
  type EvalQuestion,
  type QuestionResult,
  type RankSummary,
  type ThresholdSuggestion,
} from '../eval/metrics.js';

const QUESTIONS = fileURLToPath(new URL('../../eval/questions.json', import.meta.url));
const REPORTS = fileURLToPath(new URL('../../../../reports/eval/', import.meta.url));
const KS = [1, 3, 6];

interface EvalRun {
  table: string;
  /** Diversification variant; '' = default (one chunk per section). */
  variant?: string;
  embedder: string;
  date: string;
  k: number;
  docs: { page: RankSummary; section: RankSummary };
  tricky: { page: RankSummary; section: RankSummary };
  threshold: ThresholdSuggestion | null;
  questions: (QuestionResult & { top: { url: string; score: number }[] })[];
}

const { values: args } = parseArgs({
  options: {
    suffix: { type: 'string' },
    k: { type: 'string' },
    verbose: { type: 'boolean', default: false },
    'no-dedupe': { type: 'boolean', default: false },
    'per-page': { type: 'string' },
    report: { type: 'boolean', default: false },
  },
});

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f3 = (x: number) => x.toFixed(3);

if (args.report) {
  printReport();
  process.exit(0);
}

const k = args.k ? Number(args.k) : DEFAULT_TOP_K;
const limits = {
  maxPerSection: args['no-dedupe'] ? Infinity : 1,
  maxPerPage: args['per-page'] ? Number(args['per-page']) : Infinity,
};
const variant = [args['no-dedupe'] ? 'raw' : '', args['per-page'] ? `p${args['per-page']}` : '']
  .filter(Boolean)
  .join('_');
const config = loadConfig();
const embedder = createEmbedder(config);
const table = tableForConfig(config, args.suffix);
const { questions } = JSON.parse(readFileSync(QUESTIONS, 'utf8')) as { questions: EvalQuestion[] };

const pool = createPool(config);
const results: EvalRun['questions'] = [];
try {
  // One embedding call for all questions; then one search per question.
  const vectors = await embedder.embed(
    questions.map((q) => q.question),
    'query',
  );
  for (const [i, q] of questions.entries()) {
    const hits = await searchChunks(pool, table, vectors[i]!, { k, ...limits });
    const urls = hits.map((h) => h.url);
    results.push({
      id: q.id,
      kind: q.kind,
      topScore: hits[0]?.score ?? 0,
      pageRank: q.expected.length ? firstHitRank(urls, q.expected, 'page') : null,
      sectionRank: q.expected.length ? firstHitRank(urls, q.expected, 'section') : null,
      top: hits.map((h) => ({ url: h.url, score: h.score })),
    });
  }
} finally {
  await pool.end();
}

const ranksOf = (kind: EvalQuestion['kind']) => {
  const rs = results.filter((r) => r.kind === kind);
  return {
    page: summarizeRanks(
      rs.map((r) => r.pageRank),
      KS,
    ),
    section: summarizeRanks(
      rs.map((r) => r.sectionRank),
      KS,
    ),
  };
};
const run: EvalRun = {
  table,
  variant,
  embedder: embedder.id,
  date: new Date().toISOString(),
  k,
  docs: ranksOf('docs'),
  tricky: ranksOf('tricky'),
  threshold: suggestThreshold(
    results.filter((r) => r.kind !== 'off-topic').map((r) => r.topScore),
    results.filter((r) => r.kind === 'off-topic').map((r) => r.topScore),
  ),
  questions: results,
};

const rank = (r: number | null) => (r === null ? '—' : String(r));
console.log(`${embedder.id} on ${label(run)}, top-${k}\n`);
console.log('id   kind       top    page sect  question');
for (const [i, r] of results.entries()) {
  const q = questions[i]!;
  console.log(
    `${r.id}  ${r.kind.padEnd(9)}  ${f3(r.topScore)}  ${rank(r.pageRank).padStart(4)} ${rank(r.sectionRank).padStart(4)}  ${q.question}`,
  );
  if (args.verbose) {
    for (const h of r.top) console.log(`${' '.repeat(18)}${f3(h.score)}  ${h.url}`);
  }
}

const line = (label: string, s: RankSummary) =>
  `  ${label.padEnd(13)} ${KS.map((kk) => `hit@${kk} ${pct(s.hitAt[kk]!)}`).join('  ')}  MRR ${f3(s.mrr)}  (n=${s.n})`;
console.log(`\n${line('docs page', run.docs.page)}\n${line('docs section', run.docs.section)}`);
console.log(`${line('tricky page', run.tricky.page)}\n${line('tricky sect.', run.tricky.section)}`);

const t = run.threshold;
if (t) {
  console.log(
    `\n  "not in the docs": answerable min ${f3(t.minAnswerable)}, off-topic max ${f3(t.maxOffTopic)} → ` +
      (t.separable
        ? `separable, threshold ≈ ${f3(t.threshold)}`
        : `overlap, best cut ${f3(t.threshold)} with ${t.errors} misclassified`),
  );
}

mkdirSync(REPORTS, { recursive: true });
const out = join(REPORTS, `${variant ? `${table}__${variant}` : table}.json`);
writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
console.log(`\nsaved ${out}`);

function printReport() {
  let files: string[] = [];
  try {
    files = readdirSync(REPORTS).filter((f) => f.endsWith('.json'));
  } catch {
    // no runs yet
  }
  if (!files.length) {
    console.log('No saved runs. Run `npm run eval` first.');
    return;
  }
  const runs = files.map((f) => JSON.parse(readFileSync(join(REPORTS, f), 'utf8')) as EvalRun);
  console.log(
    '| Index | hit@1 | hit@3 | hit@6 | MRR | section hit@3 | tricky hit@6 | answerable min | off-topic max |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of runs.sort((a, b) => b.docs.page.mrr - a.docs.page.mrr)) {
    const p = r.docs.page;
    console.log(
      `| \`${label(r)}\` | ${pct(p.hitAt[1]!)} | ${pct(p.hitAt[3]!)} | ${pct(p.hitAt[6]!)} | ${f3(p.mrr)} | ` +
        `${pct(r.docs.section.hitAt[3]!)} | ${pct(r.tricky.page.hitAt[6]!)} | ` +
        `${r.threshold ? f3(r.threshold.minAnswerable) : '—'} | ${r.threshold ? f3(r.threshold.maxOffTopic) : '—'} |`,
    );
  }
}

function label(r: Pick<EvalRun, 'table' | 'variant'>) {
  return r.variant ? `${r.table} (${r.variant})` : r.table;
}

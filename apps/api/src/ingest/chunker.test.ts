import { describe, expect, it } from 'vitest';
import { chunkMarkdown, estimateTokens, splitBlocks } from './chunker.js';

const words = (n: number, word = 'lorem') => Array(n).fill(word).join(' ');
const opts = { maxTokens: 100, overlapTokens: 20, minTokens: 10 };

describe('chunkMarkdown', () => {
  it('starts a chunk at each heading and records the heading path and anchor', () => {
    const md = [
      '### Guards',
      words(20, 'intro'),
      '#### Authorization guard',
      words(20, 'auth'),
      '##### Execution context',
      words(20, 'ctx'),
      '#### Role-based authentication',
      words(20, 'roles'),
    ].join('\n\n');

    const chunks = chunkMarkdown(md, opts);
    expect(chunks.map((c) => [c.headingPath, c.anchor])).toEqual([
      [['Guards'], null],
      [['Guards', 'Authorization guard'], 'authorization-guard'],
      [['Guards', 'Authorization guard', 'Execution context'], 'execution-context'],
      [['Guards', 'Role-based authentication'], 'role-based-authentication'],
    ]);
    // The page title lives in the heading path only; section headings stay in the text.
    expect(chunks[0]!.content.startsWith('intro')).toBe(true);
    expect(chunks[1]!.content.startsWith('#### Authorization guard')).toBe(true);
  });

  it('ignores "#" lines inside code blocks', () => {
    const md = ['### Page', words(20), '```bash', '# install', 'npm i', '```'].join('\n\n');
    const chunks = chunkMarkdown(md, opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain('# install');
  });

  it('opens a subsection with its tiny parent intro', () => {
    const md = ['### Page', words(20), '#### Fastify', 'Intro.', '##### Options', words(20)].join(
      '\n\n',
    );
    const chunks = chunkMarkdown(md, opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.headingPath).toEqual(['Page', 'Fastify']);
    expect(chunks[1]!.content).toMatch(/^#### Fastify\n\nIntro\.\n\n##### Options/);
  });

  it('appends a tiny trailing note to the previous chunk of the same parent', () => {
    const md = [
      '### Page',
      '#### Fastify',
      words(20, 'fastify'),
      '##### Example',
      'See the repo.',
      '#### Express',
      words(20, 'express'),
    ].join('\n\n');
    const chunks = chunkMarkdown(md, opts);
    expect(chunks.map((c) => c.anchor)).toEqual(['fastify', 'express']);
    expect(chunks[0]!.content).toContain('##### Example\n\nSee the repo.');
    expect(chunks[1]!.content).not.toContain('Example');
  });

  it('packs a long section from whole blocks with overlap, never over the limit', () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => words(10, `p${i}xx`)); // ~15 tokens each
    const md = ['### Page', ...paragraphs].join('\n\n');
    const chunks = chunkMarkdown(md, opts);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(opts.maxTokens);
    // The last paragraph of one chunk opens the next one.
    const lastOfFirst = chunks[0]!.content.split('\n\n').at(-1)!;
    expect(chunks[1]!.content.startsWith(lastOfFirst)).toBe(true);
    // Nothing is lost.
    for (const p of paragraphs) expect(chunks.some((c) => c.content.includes(p))).toBe(true);
  });

  it('keeps a code block whole when it fits', () => {
    const code = [
      '```ts',
      ...Array.from({ length: 10 }, (_, i) => `const a${i} = ${i};`),
      '```',
    ].join('\n');
    const md = ['### Page', words(60), code].join('\n\n');
    const chunks = chunkMarkdown(md, opts);
    expect(chunks.filter((c) => c.content.includes('```ts'))).toHaveLength(1);
    expect(chunks.find((c) => c.content.includes('```ts'))!.content).toContain(code);
  });

  it('splits an oversized code block on lines and re-fences every piece', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `const value${i} = compute(${i});`);
    const md = ['### Page', ['```ts', ...lines, '```'].join('\n')].join('\n\n');
    const chunks = chunkMarkdown(md, opts);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokens).toBeLessThanOrEqual(opts.maxTokens);
      expect(c.content.startsWith('```ts\n')).toBe(true);
      expect(c.content.endsWith('\n```')).toBe(true);
    }
    for (const line of lines) expect(chunks.some((c) => c.content.includes(line))).toBe(true);
  });

  it('splits an oversized table on rows and repeats its header', () => {
    const rows = Array.from({ length: 30 }, (_, i) => `| \`option${i}\` | what option ${i} does |`);
    const md = ['### Page', ['| Option | Purpose |', '| --- | --- |', ...rows].join('\n')].join(
      '\n\n',
    );
    const chunks = chunkMarkdown(md, opts);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokens).toBeLessThanOrEqual(opts.maxTokens);
      expect(c.content.startsWith('| Option | Purpose |\n| --- | --- |\n')).toBe(true);
    }
    for (const row of rows) expect(chunks.some((c) => c.content.includes(row))).toBe(true);
  });
});

describe('splitBlocks', () => {
  it('keeps blank lines inside a code block', () => {
    expect(splitBlocks('a\n\n```ts\nx\n\ny\n```\n\nb')).toEqual(['a', '```ts\nx\n\ny\n```', 'b']);
  });
});

describe('estimateTokens', () => {
  it('is about four characters per token', () => {
    expect(estimateTokens('abcd'.repeat(25))).toBe(25);
  });
});

/**
 * Splits a cleaned markdown page into retrieval chunks.
 *
 * 1. Sections: every heading starts one, carrying the chain of headings above it.
 * 2. A section that fits `maxTokens` is one chunk. A longer one is packed from whole blocks
 *    (paragraphs, lists, fenced code), and each next chunk repeats the last blocks of the previous
 *    one up to `overlapTokens`, so an idea that straddles the cut is still found.
 * 3. Code blocks are never cut, unless a single block alone exceeds `maxTokens`; then it is split
 *    on line boundaries and every piece is re-fenced so it stays valid markdown.
 * 4. A tiny section (a heading with one line under it) is merged into the next one, when they fit
 *    together: alone it would be a vector of almost nothing.
 *
 * Token counts are an estimate (~4 characters per token for English). Exact counts would need the
 * tokenizer of each embedding model; for sizing chunks the estimate is enough.
 */
import { headingAnchor, plainHeading } from './markdown.js';

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
  minTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 700,
  overlapTokens: 80,
  minTokens: 80,
};

export interface Chunk {
  /** Headings from the page title down to the section this chunk starts in. */
  headingPath: string[];
  /** Id of the section heading on the page, null for the page's own top section. */
  anchor: string | null;
  content: string;
  tokens: number;
}

interface Section {
  headingPath: string[];
  anchor: string | null;
  /** Markdown of the section, its own heading line included (except for the page title). */
  body: string;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let titleLevel: number | null = null;
  let current: Section = { headingPath: [], anchor: null, body: '' };
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    current.body = lines.join('\n').trim();
    sections.push(current);
    lines = [];
  };

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(HEADING);
    if (!heading) {
      lines.push(line);
      continue;
    }

    flush();
    const level = heading[1]!.length;
    const text = plainHeading(heading[2]!);
    titleLevel ??= level;
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();
    stack.push({ level, text });

    const isTitle = level <= titleLevel;
    current = {
      headingPath: stack.map((h) => h.text),
      anchor: isTitle ? null : headingAnchor(heading[2]!),
      body: '',
    };
    // The title goes into the heading path (and so into every vector); repeating it is noise.
    if (!isTitle) lines.push(line);
  }
  flush();

  return sections.filter((s) => s.body.length > 0 || s.headingPath.length > 0);
}

/** Blank-line separated blocks, with a fenced code block (blank lines and all) kept as one. */
export function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let inFence = false;

  const flush = () => {
    const block = lines.join('\n').trim();
    if (block) blocks.push(block);
    lines = [];
  };

  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      if (!inFence) flush();
      inFence = !inFence;
      lines.push(line);
      if (!inFence) flush();
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    lines.push(line);
  }
  flush();
  return blocks;
}

/**
 * Splits a block that alone is over the limit: code on line boundaries (re-fenced), a table on
 * rows (header repeated, so every piece still says what its columns are), prose on sentences.
 */
function splitOversized(block: string, maxTokens: number): string[] {
  const lines = block.split('\n');
  let head = '';
  let tail = '';
  let units: string[];
  let joiner = '\n';

  if (FENCE.test(lines[0]!)) {
    const closed = lines.length > 1 && FENCE.test(lines.at(-1)!);
    head = `${lines[0]}\n`;
    tail = `\n${closed ? lines.at(-1) : '```'}`;
    units = lines.slice(1, closed ? -1 : undefined);
  } else if (lines.length > 2 && lines.every((l) => l.trimStart().startsWith('|'))) {
    head = `${lines[0]}\n${lines[1]}\n`;
    units = lines.slice(2);
  } else {
    units = block.split(/(?<=[.!?])\s+/);
    joiner = ' ';
  }

  const budget = maxTokens - estimateTokens(head + tail);
  const pieces: string[] = [];
  let piece: string[] = [];
  for (const unit of units) {
    if (piece.length && estimateTokens([...piece, unit].join(joiner)) > budget) {
      pieces.push(piece.join(joiner));
      piece = [];
    }
    piece.push(unit);
  }
  if (piece.length) pieces.push(piece.join(joiner));
  return pieces.map((p) => head + p + tail);
}

function packSection(body: string, options: ChunkOptions): string[] {
  if (estimateTokens(body) <= options.maxTokens) return [body];

  const blocks = splitBlocks(body).flatMap((b) =>
    estimateTokens(b) > options.maxTokens ? splitOversized(b, options.maxTokens) : [b],
  );

  const chunks: string[] = [];
  let current: string[] = [];
  const size = (blocks: string[]) => estimateTokens(blocks.join('\n\n'));

  for (const block of blocks) {
    if (current.length && size([...current, block]) > options.maxTokens) {
      chunks.push(current.join('\n\n'));
      // Carry trailing whole blocks of the previous chunk, as many as fit into the overlap budget.
      const overlap: string[] = [];
      for (let i = current.length - 1; i >= 0; i--) {
        if (size([current[i]!, ...overlap]) > options.overlapTokens) break;
        overlap.unshift(current[i]!);
      }
      current = size([...overlap, block]) <= options.maxTokens ? overlap : [];
    }
    current.push(block);
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

const isAncestor = (ancestor: string[], of: string[]) =>
  ancestor.length < of.length && ancestor.every((h, i) => of[i] === h);

/**
 * Where a tiny section goes. A heading followed by its own subsection ("#### Fastify" then
 * "##### Options") is an intro: it opens the subsection's chunk. Otherwise it is a trailing note
 * ("##### Example — see the repo") and joins the previous chunk of the same parent, whose heading
 * path still describes it. Merging never pushes a chunk over the limit.
 */
export function chunkMarkdown(
  markdown: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const chunks: Chunk[] = [];
  let pending: Section | null = null;
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n');

  const placeTiny = (tiny: Section) => {
    const last = chunks.at(-1);
    const parent = tiny.headingPath.slice(0, -1);
    const sameParent = last && parent.every((h, i) => last.headingPath[i] === h);
    if (last && sameParent && estimateTokens(join(last.content, tiny.body)) <= options.maxTokens) {
      last.content = join(last.content, tiny.body);
      last.tokens = estimateTokens(last.content);
    } else {
      chunks.push(...toChunks(tiny, options));
    }
  };

  for (const section of parseSections(markdown)) {
    // A page title straight followed by a subheading has no text of its own.
    if (!section.body) continue;
    let next = section;
    if (pending) {
      const body = join(pending.body, section.body);
      if (
        isAncestor(pending.headingPath, section.headingPath) &&
        estimateTokens(body) <= options.maxTokens
      ) {
        next = { ...pending, body };
      } else {
        placeTiny(pending);
      }
      pending = null;
    }
    if (estimateTokens(next.body) < options.minTokens) pending = next;
    else chunks.push(...toChunks(next, options));
  }
  if (pending) placeTiny(pending);
  return chunks;
}

function toChunks(section: Section, options: ChunkOptions): Chunk[] {
  if (!section.body) return [];
  return packSection(section.body, options).map((content) => ({
    headingPath: section.headingPath,
    anchor: section.anchor,
    content,
    tokens: estimateTokens(content),
  }));
}

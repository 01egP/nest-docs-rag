/**
 * Turns docs.nestjs.com's flavour of markdown into plain markdown worth embedding.
 *
 * The source has site-specific markup that only adds noise to a vector:
 * - code blocks hold a TypeScript and a JavaScript variant split by `@@switch` — keep TS only;
 * - `@@filename(auth.guard)` lines name the file a snippet belongs to — keep as a comment;
 * - callouts are written `> info **Hint** ...` — drop the type word;
 * - inline HTML (figures, tables, Angular banners) — keep the text, drop the tags.
 */

const FENCE = /^\s*(```|~~~)/;

// Only real HTML tags are stripped. Anything else in angle brackets (`Promise<string>`) is content.
const HTML_TAGS = [
  'a',
  'b',
  'br',
  'code',
  'div',
  'em',
  'figcaption',
  'figure',
  'i',
  'iframe',
  'img',
  'li',
  'ol',
  'p',
  'small',
  'span',
  'strong',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
  'app-[a-z-]+',
].join('|');
const HTML_TAG = new RegExp(`</?(?:${HTML_TAGS})(?:\\s[^>]*)?/?>`, 'gi');

function cleanProseLine(line: string): string {
  return (
    line
      .replace(/<!--.*?-->/g, '')
      .replace(/^>\s*(?:info|warning|error)\s+/, '> ')
      // Keep table cells apart and inline code recognisable once the tags are gone.
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<\/?code>/gi, '`')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(HTML_TAG, '')
      .replace(/\s+$/, '')
  );
}

export function cleanMarkdown(source: string): string {
  const out: string[] = [];
  let inFence = false;
  let skippingVariant = false;

  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (FENCE.test(line)) {
      if (inFence) skippingVariant = false;
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      if (skippingVariant) continue;
      if (line.trim() === '@@switch') {
        skippingVariant = true;
        continue;
      }
      const file = line.match(/^@@filename\(([^)]*)\)\s*$/);
      if (file) {
        if (file[1]) out.push(`// ${file[1]}`);
        continue;
      }
      out.push(line);
      continue;
    }

    const clean = cleanProseLine(line);
    // Tables are padded with spaces to align columns: tokens that carry nothing.
    out.push(clean.trimStart().startsWith('|') ? clean.replace(/ {2,}/g, ' ') : clean);
  }

  // A tag-only line (a figure, a banner) leaves an empty line behind; collapse the runs.
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Heading text as a reader sees it: no inline-code ticks, link targets or emphasis. */
export function plainHeading(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
}

/**
 * The id docs.nestjs.com gives a heading: its rendered text, whitespace -> "-", lower-cased
 * (`HeaderAnchorDirective.getImplicitId` in the docs repo). Punctuation is kept on purpose.
 */
export function headingAnchor(text: string): string {
  return plainHeading(text).replace(/\s/g, '-').toLowerCase();
}

/**
 * The model's answer is plain text with a little Markdown (`inline code`, ``` fences) and `[n]`
 * citation markers. This splits it into blocks and inline parts for rendering — enough for these
 * answers without pulling in a Markdown library. Anything else (bold, lists) stays as typed.
 */
export type Inline =
  { kind: 'text'; text: string } | { kind: 'code'; text: string } | { kind: 'cite'; n: number };

export type Block =
  { kind: 'paragraph'; parts: Inline[] } | { kind: 'code'; lang: string; text: string };

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  // An unclosed fence (mid-stream) runs to the end of the text.
  const fence = /```([\w-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const m of text.matchAll(fence)) {
    pushParagraphs(blocks, text.slice(last, m.index));
    blocks.push({ kind: 'code', lang: m[1] ?? '', text: (m[2] ?? '').replace(/\n$/, '') });
    last = m.index + m[0].length;
  }
  pushParagraphs(blocks, text.slice(last));
  return blocks;
}

function pushParagraphs(blocks: Block[], text: string) {
  for (const para of text.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (trimmed) blocks.push({ kind: 'paragraph', parts: parseInline(trimmed) });
  }
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const token = /`([^`\n]+)`|\[(\d+)\]/g;
  let last = 0;
  for (const m of text.matchAll(token)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) });
    parts.push(
      m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'cite', n: Number(m[2]) },
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

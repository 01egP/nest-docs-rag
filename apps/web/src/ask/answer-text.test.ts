import { describe, expect, it } from 'vitest';
import { parseAnswer, parseInline } from './answer-text';

describe('parseInline', () => {
  it('splits text, inline code and citation markers', () => {
    expect(parseInline('Use `useGlobalGuards()` in main.ts [1][2].')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'useGlobalGuards()' },
      { kind: 'text', text: ' in main.ts ' },
      { kind: 'cite', n: 1 },
      { kind: 'cite', n: 2 },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves an unclosed backtick and non-numeric brackets as text', () => {
    expect(parseInline('a `b [x]')).toEqual([{ kind: 'text', text: 'a `b [x]' }]);
  });

  it('does not treat [n] inside code as a citation', () => {
    expect(parseInline('`arr[0]`')).toEqual([{ kind: 'code', text: 'arr[0]' }]);
  });
});

describe('parseAnswer', () => {
  it('splits paragraphs and fenced code', () => {
    const text =
      'First [1].\n\n```ts\napp.useGlobalGuards(new RolesGuard());\n```\n\nThen `APP_GUARD` [2].';
    expect(parseAnswer(text)).toEqual([
      {
        kind: 'paragraph',
        parts: [
          { kind: 'text', text: 'First ' },
          { kind: 'cite', n: 1 },
          { kind: 'text', text: '.' },
        ],
      },
      { kind: 'code', lang: 'ts', text: 'app.useGlobalGuards(new RolesGuard());' },
      {
        kind: 'paragraph',
        parts: [
          { kind: 'text', text: 'Then ' },
          { kind: 'code', text: 'APP_GUARD' },
          { kind: 'text', text: ' ' },
          { kind: 'cite', n: 2 },
          { kind: 'text', text: '.' },
        ],
      },
    ]);
  });

  it('renders a fence the stream has not closed yet as code', () => {
    expect(parseAnswer('Like this:\n```ts\nconst a = 1;')).toEqual([
      { kind: 'paragraph', parts: [{ kind: 'text', text: 'Like this:' }] },
      { kind: 'code', lang: 'ts', text: 'const a = 1;' },
    ]);
  });

  it('gives nothing for empty text', () => {
    expect(parseAnswer('')).toEqual([]);
  });
});

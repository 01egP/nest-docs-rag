import { describe, expect, it } from 'vitest';
import { cleanMarkdown, headingAnchor } from './markdown.js';

describe('cleanMarkdown', () => {
  it('keeps the TypeScript variant and the file name, drops the JavaScript one', () => {
    const source = [
      '```typescript',
      '@@filename(auth.guard)',
      'export class AuthGuard implements CanActivate {}',
      '@@switch',
      'export class AuthGuard {}',
      '```',
      'After.',
    ].join('\n');
    expect(cleanMarkdown(source)).toBe(
      [
        '```typescript',
        '// auth.guard',
        'export class AuthGuard implements CanActivate {}',
        '```',
        'After.',
      ].join('\n'),
    );
  });

  it('drops the callout type word', () => {
    expect(cleanMarkdown('> info **Hint** Guards run after middleware.')).toBe(
      '> **Hint** Guards run after middleware.',
    );
    expect(cleanMarkdown('> warning **Warning** Careful.')).toBe('> **Warning** Careful.');
  });

  it('strips HTML tags but keeps their text, and leaves generics alone', () => {
    const source = [
      '<figure><img class="illustrative-image" src="/assets/Guards_1.png" /></figure>',
      '<app-banner-enterprise></app-banner-enterprise>',
      '<tr><td><code>whitelist</code></td><td>Strip unknown props</td></tr>',
      'Returns `Promise<string>` here.',
    ].join('\n\n');
    expect(cleanMarkdown(source)).toBe(
      '`whitelist` | Strip unknown props |\n\nReturns `Promise<string>` here.',
    );
  });

  it('drops the padding that aligns table columns', () => {
    expect(cleanMarkdown('| Option      | Default |\n| ----------- | ------- |')).toBe(
      '| Option | Default |\n| ----------- | ------- |',
    );
  });

  it('does not touch HTML-looking text inside code', () => {
    const source = '```html\n<div class="app"></div>\n```';
    expect(cleanMarkdown(source)).toBe(source);
  });
});

describe('headingAnchor', () => {
  it('matches the ids the docs site generates', () => {
    expect(headingAnchor('Arguments host')).toBe('arguments-host');
    expect(headingAnchor('Binding `@UseGuards()`')).toBe('binding-@useguards()');
    expect(headingAnchor('[Passport](https://passportjs.org) strategies')).toBe(
      'passport-strategies',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { contentHash, embedTextFor, tableName } from './store.js';

describe('tableName', () => {
  it('is one table per model, safe as an identifier', () => {
    expect(tableName('bge-m3')).toBe('chunks_bge_m3');
    expect(tableName('nomic-embed-text:latest')).toBe('chunks_nomic_embed_text');
  });

  it('separates indexes built without prefixes or for an experiment', () => {
    expect(tableName('nomic-embed-text', { noPrefix: true })).toBe(
      'chunks_nomic_embed_text_noprefix',
    );
    expect(tableName('bge-m3', { suffix: 'c400' })).toBe('chunks_bge_m3_c400');
  });
});

describe('contentHash', () => {
  it('changes when the embedded text or the URL changes', () => {
    const base = { url: 'https://docs.nestjs.com/guards', embedText: 'Guards\n\ntext' };
    expect(contentHash(base)).toBe(contentHash({ ...base }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, embedText: 'Guards\n\nedited' }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, url: `${base.url}#binding-guards` }));
  });
});

describe('embedTextFor', () => {
  it('prepends the heading path', () => {
    expect(embedTextFor(['Guards', 'Binding guards'], 'Use @UseGuards().')).toBe(
      'Guards > Binding guards\n\nUse @UseGuards().',
    );
  });
});

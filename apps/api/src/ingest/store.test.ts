import { describe, expect, it } from 'vitest';
import { contentHash, embedTextFor, tableForConfig, tableName } from './store.js';

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
    expect(tableName('bge-m3', { noHeadings: true })).toBe('chunks_bge_m3_noheadings');
  });
});

describe('tableForConfig', () => {
  const base = { EMBED_MODEL: 'nomic-embed-text', EMBED_USE_PREFIXES: true, EMBED_HEADINGS: true };

  it('names the table after every setting that changes the vectors', () => {
    expect(tableForConfig(base)).toBe('chunks_nomic_embed_text');
    expect(tableForConfig({ ...base, EMBED_USE_PREFIXES: false }, 'c400')).toBe(
      'chunks_nomic_embed_text_noprefix_c400',
    );
    expect(tableForConfig({ ...base, EMBED_HEADINGS: false })).toBe(
      'chunks_nomic_embed_text_noheadings',
    );
  });

  it('ignores the prefix switch for a model without prefixes', () => {
    expect(tableForConfig({ ...base, EMBED_MODEL: 'bge-m3', EMBED_USE_PREFIXES: false })).toBe(
      'chunks_bge_m3',
    );
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

  it('leaves the chunk alone without headings', () => {
    expect(embedTextFor(['Guards'], 'Use @UseGuards().', false)).toBe('Use @UseGuards().');
  });
});

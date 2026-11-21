import { describe, expect, it, vi } from 'vitest';
import type { OllamaClient } from './client.js';
import { OllamaEmbedder } from './ollama-embedder.js';

function fakeClient(dimensions: number) {
  const post = vi.fn(async (_path: string, body: unknown) => {
    const { input } = body as { input: string[] };
    return { embeddings: input.map(() => Array(dimensions).fill(0)) };
  });
  return { client: { post } as unknown as OllamaClient, post };
}

const sentInputs = (post: ReturnType<typeof fakeClient>['post']) =>
  (post.mock.calls[0]![1] as { input: string[] }).input;

describe('OllamaEmbedder', () => {
  it('applies query and document prefixes for asymmetric models', async () => {
    const { client, post } = fakeClient(768);
    const embedder = new OllamaEmbedder(client, 'nomic-embed-text');

    await embedder.embed(['guards'], 'query');
    await embedder.embed(['Guards decide...'], 'document');

    expect(sentInputs(post)).toEqual(['search_query: guards']);
    expect((post.mock.calls[1]![1] as { input: string[] }).input).toEqual([
      'search_document: Guards decide...',
    ]);
  });

  it('sends raw text when prefixes are disabled', async () => {
    const { client, post } = fakeClient(768);
    await new OllamaEmbedder(client, 'nomic-embed-text', false).embed(['guards'], 'query');
    expect(sentInputs(post)).toEqual(['guards']);
  });

  it('accepts the :latest tag', () => {
    expect(new OllamaEmbedder(fakeClient(1024).client, 'bge-m3:latest').dimensions).toBe(1024);
  });

  it('rejects unknown models instead of guessing a dimension', () => {
    expect(() => new OllamaEmbedder(fakeClient(1).client, 'some-model')).toThrow(/Unknown/);
  });

  it('fails loudly on a dimension mismatch', async () => {
    const { client } = fakeClient(512);
    await expect(new OllamaEmbedder(client, 'bge-m3').embed(['x'], 'query')).rejects.toThrow(
      /expected dimension 1024, got 512/,
    );
  });

  it('skips the network call for an empty batch', async () => {
    const { client, post } = fakeClient(1024);
    expect(await new OllamaEmbedder(client, 'bge-m3').embed([], 'document')).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });
});

/**
 * Known local embedding models. Dimensions are fixed per model; prefixes come from each model card.
 * An unknown model is rejected instead of guessed, because a wrong dimension or a missing prefix
 * silently degrades retrieval rather than failing loudly.
 */
export interface EmbeddingModelSpec {
  dimensions: number;
  queryPrefix: string;
  documentPrefix: string;
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
  // Multilingual; finds English docs for Russian questions. No prefixes.
  'bge-m3': { dimensions: 1024, queryPrefix: '', documentPrefix: '' },
  'nomic-embed-text': {
    dimensions: 768,
    queryPrefix: 'search_query: ',
    documentPrefix: 'search_document: ',
  },
  // Prefix on the query side only.
  'mxbai-embed-large': {
    dimensions: 1024,
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
  },
};

export function getEmbeddingModel(model: string): EmbeddingModelSpec {
  // Ollama accepts both "bge-m3" and "bge-m3:latest".
  const spec = EMBEDDING_MODELS[model.replace(/:latest$/, '')];
  if (!spec) {
    const known = Object.keys(EMBEDDING_MODELS).join(', ');
    throw new Error(`Unknown embedding model "${model}". Known: ${known}`);
  }
  return spec;
}

import type { Config } from '../config.js';
import { fileURLToPath } from 'node:url';
import type { Embedder, Generator, Reranker } from './types.js';
import { OllamaClient } from './ollama/client.js';
import { OllamaEmbedder } from './ollama/ollama-embedder.js';
import { OllamaGenerator } from './ollama/ollama-generator.js';
import { OpenAICompatibleGenerator } from './openai/openai-generator.js';
import { TransformersReranker } from './transformers/transformers-reranker.js';

export type { Embedder, Generator, Reranker } from './types.js';

const MODELS_DIR = fileURLToPath(new URL('../../../../data/models/', import.meta.url));

export function createEmbedder(config: Config): Embedder {
  switch (config.EMBED_PROVIDER) {
    case 'ollama':
      return new OllamaEmbedder(
        new OllamaClient(config.OLLAMA_URL),
        config.EMBED_MODEL,
        config.EMBED_USE_PREFIXES,
      );
    default:
      throw new Error(`EMBED_PROVIDER=${config.EMBED_PROVIDER} is not implemented yet`);
  }
}

export function createGenerator(config: Config): Generator {
  switch (config.CHAT_PROVIDER) {
    case 'ollama':
      return new OllamaGenerator(
        new OllamaClient(config.OLLAMA_URL),
        config.CHAT_MODEL,
        config.CHAT_THINK,
        config.CHAT_NUM_CTX,
      );
    case 'openai':
      return new OpenAICompatibleGenerator({
        baseUrl: config.OPENAI_BASE_URL,
        apiKey: config.OPENAI_API_KEY!, // checked by loadConfig
        model: config.CHAT_MODEL,
      });
    default:
      throw new Error(`CHAT_PROVIDER=${config.CHAT_PROVIDER} is not implemented yet`);
  }
}

/** `null` when reranking is off (RERANK_PROVIDER=none): search order is the vector order. */
export function createReranker(config: Config): Reranker | null {
  switch (config.RERANK_PROVIDER) {
    case 'none':
      return null;
    case 'transformers':
      return new TransformersReranker(config.RERANK_MODEL, config.RERANK_DTYPE, MODELS_DIR);
  }
}

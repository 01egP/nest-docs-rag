import type { Config } from '../config.js';
import type { Embedder, Generator } from './types.js';
import { OllamaClient } from './ollama/client.js';
import { OllamaEmbedder } from './ollama/ollama-embedder.js';
import { OllamaGenerator } from './ollama/ollama-generator.js';

export type { Embedder, Generator } from './types.js';

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
      );
    default:
      throw new Error(`CHAT_PROVIDER=${config.CHAT_PROVIDER} is not implemented yet`);
  }
}

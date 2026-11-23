import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// One .env at the repo root is shared by docker compose and the API; defaults and allowed values
// live here.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

const schema = z
  .object({
    DB_HOST: z.string().default('localhost'),
    // 5433 on the host, so it does not clash with a locally installed Postgres on 5432
    DB_PORT: z.coerce.number().int().default(5433),
    // Credentials have no defaults: they must come from .env. Postgres applies them when its data
    // volume is first created; to change them later, change the role in the database too.
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_NAME: z.string().default('rag'),

    API_PORT: z.coerce.number().int().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Which implementation backs the Embedder / Generator interfaces. Embeddings: only "ollama" is
    // implemented. Chat: "ollama", or "openai" — any OpenAI-compatible Chat Completions API (OpenAI,
    // Abacus RouteLLM, …) at OPENAI_BASE_URL. "claude" is a planned stub.
    EMBED_PROVIDER: z.enum(['ollama', 'openai', 'claude']).default('ollama'),
    CHAT_PROVIDER: z.enum(['ollama', 'openai', 'claude']).default('ollama'),

    OLLAMA_URL: z.string().url().default('http://localhost:11434'),
    // bge-m3 | nomic-embed-text | mxbai-embed-large (see providers/embedding-models.ts)
    EMBED_MODEL: z.string().default('bge-m3'),
    // Apply the model's query/document prefixes (nomic, mxbai); turn off to measure their effect
    EMBED_USE_PREFIXES: bool(true),
    CHAT_MODEL: z.string().default('qwen3:8b'),
    // qwen3 is a "thinking" model; reasoning tokens are slow and not needed for grounded answers
    CHAT_THINK: bool(false),
    // Context window for the chat model, in tokens. Ollama silently drops the start of a prompt that
    // does not fit, and /ask sends up to six ~700-token chunks, so this is set explicitly.
    CHAT_NUM_CTX: z.coerce.number().int().positive().default(8192),

    // CHAT_PROVIDER=openai: the API's base URL (up to /v1) and key. CHAT_MODEL is then that API's model
    // name, e.g. "claude-haiku-5-5" on RouteLLM (https://routellm.abacus.ai/v1). The key has no default
    // and lives only in .env.
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    OPENAI_API_KEY: z.string().min(1).optional(),

    // /ask answers "not in the docs" without calling the LLM when the best hit scores below this.
    // Unset = the measured default for the active scorer (the reranker, or the embedding model).
    ASK_MIN_SCORE: z.coerce.number().min(0).max(1).optional(),

    // Cross-encoder reranking of the search candidates: transformers.js in-process; the model
    // (~0.6 GB for int8) is downloaded on first use into data/models/
    RERANK_PROVIDER: z.enum(['none', 'transformers']).default('transformers'),
    RERANK_MODEL: z.string().default('onnx-community/bge-reranker-v2-m3-ONNX'),
    RERANK_DTYPE: z.enum(['fp32', 'fp16', 'int8', 'q4']).default('int8'),
  })
  .superRefine((c, ctx) => {
    if (c.CHAT_PROVIDER === 'openai' && !c.OPENAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'required when CHAT_PROVIDER=openai',
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // `KEY=` in .env arrives as an empty string; treat it as unset so the default applies.
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(set);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

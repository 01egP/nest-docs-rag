import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// One .env at the repo root is shared by docker compose and the API.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true'));

const schema = z.object({
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5433),
  DB_USER: z.string().default('rag'),
  DB_PASSWORD: z.string().default('rag'),
  DB_NAME: z.string().default('rag'),

  API_PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  EMBED_PROVIDER: z.enum(['ollama', 'openai', 'claude']).default('ollama'),
  CHAT_PROVIDER: z.enum(['ollama', 'openai', 'claude']).default('ollama'),

  OLLAMA_URL: z.string().url().default('http://localhost:11434'),
  EMBED_MODEL: z.string().default('bge-m3'),
  EMBED_USE_PREFIXES: bool(true),
  CHAT_MODEL: z.string().default('qwen3:8b'),
  CHAT_THINK: bool(false),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

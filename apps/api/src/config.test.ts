import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const creds = { DB_USER: 'u', DB_PASSWORD: 'p' };

describe('loadConfig', () => {
  it('treats an empty value (KEY=) as unset, so the default applies', () => {
    const c = loadConfig({ ...creds, DB_PORT: '', EMBED_MODEL: '', CHAT_THINK: '' });
    expect(c.DB_PORT).toBe(5433);
    expect(c.EMBED_MODEL).toBe('bge-m3');
    expect(c.CHAT_THINK).toBe(false);
  });

  it('requires the database credentials', () => {
    expect(() => loadConfig({})).toThrow(/DB_USER[\s\S]*DB_PASSWORD/);
    expect(() => loadConfig({ DB_USER: 'u', DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
  });

  it('requires an API key only when the chat goes to an OpenAI-compatible API', () => {
    expect(loadConfig(creds).OPENAI_API_KEY).toBeUndefined();
    expect(() => loadConfig({ ...creds, CHAT_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ ...creds, CHAT_PROVIDER: 'openai', OPENAI_API_KEY: '' })).toThrow(
      /OPENAI_API_KEY/,
    );
    const c = loadConfig({ ...creds, CHAT_PROVIDER: 'openai', OPENAI_API_KEY: 'k' });
    expect(c.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
  });
});

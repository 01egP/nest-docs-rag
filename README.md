# nest-docs-rag

Ask the NestJS docs: a personal tool that answers questions about NestJS strictly from the official
documentation, with citations — or says the docs don't cover it. Runs fully locally: Ollama for
embeddings and answers, Postgres + pgvector for search.

> Work in progress. Done so far: repo scaffold, provider interfaces, local Ollama implementations.

## Stack

- **API** (`apps/api`): Node 22, TypeScript, Fastify, `pg` + `pgvector`, zod for env validation
- **Web** (`apps/web`): Vite + React
- **Storage**: Postgres 17 with pgvector (Docker)
- **Models** (Ollama): `bge-m3` embeddings by default (also `nomic-embed-text`, `mxbai-embed-large`),
  `qwen3:8b` for answers

Embedding and chat providers sit behind the `Embedder` / `Generator` interfaces
(`apps/api/src/providers/types.ts`) and are picked via env, so a paid API can replace Ollama without
touching the pipeline.

## Getting started

Prerequisites: Node 22+, Docker, [Ollama](https://ollama.com) with the models pulled:

```bash
ollama pull bge-m3 && ollama pull qwen3:8b
```

```bash
cp .env.example .env
npm install
npm run db:up        # Postgres + pgvector on localhost:5433
npm run smoke        # embed + rank two passages, then a JSON answer from the chat model
npm run dev:api      # http://127.0.0.1:3000/health
npm run dev:web      # http://localhost:5173
```

`npm test`, `npm run typecheck`, `npm run format:check` — the usual checks.

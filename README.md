# nest-docs-rag

Ask the NestJS docs: a personal tool that answers questions about NestJS strictly from the official
documentation, with citations — or says the docs don't cover it. Runs fully locally: Ollama for
embeddings and answers, Postgres + pgvector for search.

> Work in progress. Done so far: repo scaffold, provider interfaces, local Ollama implementations,
> indexing of the docs into pgvector.

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
npm run ingest       # clone the NestJS docs, chunk, embed into pgvector (a few minutes the first time)
npm run dev:api      # http://127.0.0.1:3000/health
npm run dev:web      # http://localhost:5173
```

## Indexing

`npm run ingest` turns the docs into searchable chunks:

1. **Source** — a shallow clone of [nestjs/docs.nestjs.com](https://github.com/nestjs/docs.nestjs.com)
   (MIT) in `data/raw/` (git-ignored). The pages and their URLs come from the site's own sidebar and
   route aliases, so a citation links to the live page, anchor included.
2. **Cleaning** — site-specific markup is reduced to plain markdown: the JavaScript twin of every
   code sample (`@@switch`) is dropped, `@@filename(...)` becomes a comment, callout and HTML tags go,
   table padding is collapsed.
3. **Chunking** — one chunk per heading section, up to ~700 tokens (estimated as chars / 4). Longer
   sections are packed from whole blocks with ~80 tokens of overlap; code blocks are not cut unless a
   single block is over the limit (then on line boundaries, re-fenced), long tables are split by rows
   with the header repeated. Tiny sections are merged into a neighbour instead of becoming a vector of
   almost nothing.
4. **Embedding** — the heading path (`Guards > Binding guards`) is prepended to the text, so a chunk
   carries the topic of its page even when its own text never names it.
5. **Storage** — one table per embedding model (`chunks_bge_m3`, …) with an HNSW cosine index. A run is
   a sync, keyed by a hash of the embedded text: only new or changed chunks are embedded, removed ones
   are deleted.

```bash
npm run ingest -- --dry-run                     # chunk stats and samples, no embedding, no DB
npm run ingest -- --offline                     # skip the git fetch
EMBED_MODEL=nomic-embed-text npm run ingest     # a second index to compare models
npm run ingest -- --suffix c400 --max-tokens 400   # a separate index for a chunk-size experiment
```

`npm test`, `npm run typecheck`, `npm run format:check` — the usual checks.

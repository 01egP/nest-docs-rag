# nest-docs-rag

Ask the NestJS docs: a personal tool that answers questions about NestJS strictly from the official
documentation, with citations — or says the docs don't cover it. Runs fully locally: Ollama for
embeddings and answers, Postgres + pgvector for search.

> Work in progress. Done so far: repo scaffold, provider interfaces, local Ollama implementations,
> indexing of the docs into pgvector, top-k search with cross-encoder reranking, a retrieval eval,
> `POST /ask` with citations. Next: streaming and the web page.

## Stack

- **API** (`apps/api`): Node 22, TypeScript, Fastify, `pg` + `pgvector`, zod for env validation
- **Web** (`apps/web`): Vite + React
- **Storage**: Postgres 17 with pgvector (Docker)
- **Models** (Ollama): `bge-m3` embeddings by default (also `nomic-embed-text`, `mxbai-embed-large`),
  `qwen3:8b` for answers
- **Reranker** (in-process, ONNX via `@huggingface/transformers`): `bge-reranker-v2-m3`, int8

Embedding and chat providers sit behind the `Embedder` / `Generator` interfaces
(`apps/api/src/providers/types.ts`) and are picked via env, so a paid API can replace Ollama without
touching the pipeline. The reranker sits behind `Reranker` the same way.

## Getting started

Prerequisites: Node 22+, Docker, [Ollama](https://ollama.com) with the models pulled:

```bash
ollama pull bge-m3 && ollama pull qwen3:8b
```

```bash
cp .env.example .env   # then set DB_USER and DB_PASSWORD; empty values use the defaults
npm install
npm run db:up        # Postgres + pgvector on localhost:5433
npm run smoke        # embed + rank two passages, then a JSON answer from the chat model
npm run ingest       # clone the NestJS docs, chunk, embed into pgvector (a few minutes the first time)
npm run dev:api      # http://127.0.0.1:3000/health, POST /ask
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

## Asking

```bash
curl -s http://127.0.0.1:3000/ask -H 'content-type: application/json' \
  -d '{"question": "How do I apply a guard to every route in the application?"}'
```

```jsonc
{
  "answered": true,
  "answer": "… you can use the `useGlobalGuards()` method … `{ provide: APP_GUARD, useClass: RolesGuard }` [1].",
  "citations": [
    {
      "n": 1,
      "url": "https://docs.nestjs.com/guards#binding-guards",
      "title": "Guards › Binding guards",
      "content": "…",
      "score": 0.97,
    },
  ],
  "retrieval": {
    "table": "chunks_bge_m3",
    "reranked": true,
    "topScore": 0.97,
    "minScore": 0.1,
    "sources": [/* all 6, as the model saw them */],
  },
  "generator": { "id": "ollama:qwen3:8b", "inputTokens": 2906, "outputTokens": 124 },
  "timingsMs": { "search": 11063, "generate": 19018, "total": 30081 },
}
```

The pipeline (`apps/api/src/ask/ask.ts`):

1. **Search** — embed the question, top 6 chunks as above (reranked, one per section).
2. **Threshold** — if the best score is below `ASK_MIN_SCORE`, the answer is "not in the docs" and the
   LLM is not called (`reason: "below_threshold"`). Defaults come from the eval: 0.1 on the reranker's
   score, 0.5 on bge-m3 cosine when reranking is off.
3. **Answer** — the chunks go into the prompt numbered `[1]…[6]`, with their heading path but no URL,
   and the model answers through structured output: `{answerable, answer, citations}`. The threshold
   only stops clearly unrelated questions; one about a neighbouring framework (Angular routing) shares
   the docs' vocabulary and passes it, so `answerable: false` is the second refusal
   (`reason: "model_declined"`).
4. **Citations** — the server keeps only numbers that point at a chunk it actually sent (in the list
   and in the `[n]` markers of the text) and attaches that chunk's URL and text itself, so a source
   can't be made up. An answer left with no valid citation is refused (`reason: "no_citations"`).

The refusal text follows the language of the question (Russian or English); the answer itself is
written in the language of the question too, while the docs are English.

All 15 eval questions through `/ask` (`qwen3:8b`, M1 Pro): the 10 answerable and 2 tricky ones are
answered, 11 of the 12 citing the expected page; borscht and Django stop at the threshold, Angular is
declined by the model. It is slow: 8–20 s of reranking plus 8–35 s of generation, the longer the
answer the longer the wait — hence streaming next.

`CHAT_NUM_CTX` (default 8192) sets the chat model's context window explicitly: Ollama silently drops
the start of a prompt that does not fit, and six chunks come to ~1.5–4k tokens.

## Evaluation

`npm run eval` measures retrieval on a fixed question set (`apps/api/eval/questions.json`): 10
questions answered by the docs (Russian and English, with the expected page and section), 3 off-topic
ones and 2 tricky ones (an answer split across two pages, a question worded with synonyms). For each
question it embeds the query, takes the top 6 chunks and reports:

- **hit@1 / hit@3 / hit@6 and MRR** — at page level (anchor ignored) and at section level;
- **top similarity** of every question, and whether one threshold separates answerable questions
  from off-topic ones — the input for the "not in the docs" cut-off, set per model.

```bash
npm run eval                        # the configured model's index
npm run eval -- --suffix c400       # an experiment index built with the same --suffix
npm run eval -- --verbose           # also print the top chunks of every question
npm run eval -- --no-dedupe         # raw nearest neighbours, for comparison
npm run eval -- --per-page 2        # also cap chunks per page
npm run eval -- --rerank            # re-order the candidates with the cross-encoder
npm run eval -- --candidates 20     # size of the candidate pool (default 30)
npm run eval -- --report            # Markdown table of all saved runs
```

The search keeps at most one chunk per section (URL with anchor): it fetches the 30 nearest chunks
and drops repeats, because a long section is split into several chunks and would otherwise take
several of the k slots.

### Reranking

Vector search is a bi-encoder: the question and each chunk are embedded separately, so a chunk's
vector is fixed before the question is known. Near-topic sections of other pages (rate limiting on
sign-in in a tutorial vs the Rate limiting page) end up within noise of each other. A cross-encoder
reads the question and a chunk together and scores the pair, which is far better at ordering — but
it cannot be precomputed, so it only re-orders the 30 candidates from vector search.

Ollama has no rerank endpoint, so `bge-reranker-v2-m3` (multilingual, the reranking pair of
`bge-m3`) runs in-process with ONNX Runtime; the int8 model (~0.6 GB) is downloaded on first use
into `data/models/`. Set `RERANK_PROVIDER=none` to turn it off.

First results on `chunks_bge_m3`, 10 answerable questions:

|             | hit@1 | hit@3 | hit@6 | MRR   | section hit@6 | answerable min | off-topic max | search time |
| ----------- | ----- | ----- | ----- | ----- | ------------- | -------------- | ------------- | ----------- |
| vector only | 60%   | 70%   | 80%   | 0.658 | 70%           | 0.611          | 0.637         | ~10 ms      |
| + reranker  | 50%   | 90%   | 100%  | 0.692 | 100%          | 0.619          | 0.427         | ~8.5 s      |

Every answerable question now has its page in the top 6, and its score separates it from the
off-topic ones (cosine could not: the Django serializer question scored above two real ones). The
cost is latency: about 8.5 s per question on an M1 Pro CPU (30 pairs of up to 512 tokens through a
568M-parameter model). The two "tricky" questions (an answer split across pages) get low reranker
scores, since no single chunk answers them.

Each run is saved to `reports/eval/<table>[__<variant>].json` (git-ignored); the variant names a
non-default search setting (`raw`, `p2`, `rr`, `n20`).

`npm test`, `npm run typecheck`, `npm run format:check` — the usual checks.

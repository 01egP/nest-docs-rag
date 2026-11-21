-- Runs once, on the first start of an empty data volume (`npm run db:reset` to re-run).
-- Chunk tables are created by the API per embedding model, because each model has its own
-- vector dimension and vectors from different models are not comparable.
CREATE EXTENSION IF NOT EXISTS vector;

# Solr vector-search adapter

The Solr module complements the official Solr Admin UI. It focuses on workflows that are difficult to perform there: converting plain English into embeddings, selecting one or more vector fields, tuning topK and candidate counts, comparing fields, and fusing ranked results.

## Compatibility

- SolrCloud 9.10 or newer.
- Dense vector fields using `FLOAT32`.
- Field dimensions must match `EMBEDDING_DIMENSION`, which defaults to 384.
- The application reads collection schemas but does not create or mutate Solr collections or field types.

The default model is `sentence-transformers/all-MiniLM-L6-v2`. The model is downloaded by `sentence-transformers` on first use and then loaded from the local Hugging Face cache.

## Search behavior

- Semantic mode performs Solr k-nearest-neighbor search with the generated query vector.
- Hybrid rerank mode combines a lexical query with vector reranking.
- Hybrid RRF mode fuses lexical and vector rankings.
- Compare mode runs the same query independently against selected vector fields.
- Fuse mode combines selected vector fields with per-field weights and score thresholds.
- `timeout_ms` is forwarded to Solr as `timeAllowed`; the adapter adds a small network grace period and returns HTTP 504 for timeouts.

## Ingestion

JSON, JSONL, and CSV uploads are staged locally and converted into background ingestion jobs. A job can map one or more Solr vector fields to different source-text field sets; all generated vectors are written in the same Solr update. The legacy single `vector_field` plus `text_fields` request shape remains accepted.

Uploaded data and job state are ephemeral and expire after the configured TTL or when the adapter shuts down.

Credentials belong only in `services/solr-api/.env`:

```dotenv
SOLR_USERNAME=admin
SOLR_PASSWORD=replace-me
```

Do not commit that file.

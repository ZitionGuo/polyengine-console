# Solr vector-search adapter

The Solr module complements the official Solr Admin UI. It focuses on workflows that are difficult to perform there: converting plain English into embeddings, selecting one or more vector fields, tuning topK and candidate counts, comparing fields, and fusing ranked results.

## Compatibility

- SolrCloud 9.10 or newer.
- Dense vector fields using `FLOAT32`.
- Field dimensions must match `EMBEDDING_DIMENSION`, which defaults to 384.
- The application reads collection schemas but does not create or mutate Solr collections or field types.

The default model is `sentence-transformers/all-MiniLM-L6-v2`. The model is downloaded by `sentence-transformers` on first use and then loaded from the local Hugging Face cache.

## Query embedding inspection

After a successful search, the Embedding inspector calls `POST /api/model/embed` on demand with the completed query text. It returns the exact vector together with the active model, dimension, L2 norm, value range, mean, cache state, cold-start state, and timing breakdown. Repeated inspection reuses the bounded query-embedding cache.

In the browser, the full vector is held only in the current TanStack Query memory cache and is not written to recent-search history or persistent browser storage. The adapter may retain the same vector in its bounded in-memory query cache.

## Search behavior

- Semantic mode performs Solr k-nearest-neighbor search with the generated query vector.
- Hybrid rerank mode combines a lexical query with vector reranking.
- Hybrid RRF mode fuses lexical and vector rankings.
- Compare mode runs the same query independently against selected vector fields.
- Fuse mode combines selected vector fields with per-field weights and score thresholds.
- `timeout_ms` is forwarded to Solr as `timeAllowed`; the adapter adds a small network grace period and returns HTTP 504 for timeouts.

## Metadata refresh

Collection names and schemas use an in-memory TTL controlled by `SOLR_METADATA_CACHE_TTL_SECONDS`. Ordinary navigation and query refetches reuse that cache.

The Collections **Refresh** action calls `GET /api/collections?refresh=true` and clears all cached Solr metadata before loading. The refresh icon beside vector-field controls calls `GET /api/collections/{collection}/schema?refresh=true`, invalidating only that collection and the collection-name cache. Valid vector, lexical, and return-field selections are retained after refresh; removed or newly incompatible fields fall back to available values.

## Ingestion

JSON, JSONL, and CSV uploads are staged locally and converted into background ingestion jobs. A job can map one or more Solr vector fields to different source-text field sets; all generated vectors are written in the same Solr update. The legacy single `vector_field` plus `text_fields` request shape remains accepted.

Failures retain their original one-based source row numbers. `POST /api/ingest/jobs/{job_id}/retry` creates a linked job that revalidates the current Solr schema and processes only those failed rows with the original vector mappings. The source job remains unchanged for auditing.

The Ingest page loads error details in bounded pages from `GET /api/ingest/jobs/{job_id}/error-rows`, including the source row, document ID, and normalized error message. The existing `GET /api/ingest/jobs/{job_id}/errors` endpoint remains available for a complete CSV export.

Uploaded data and job state are ephemeral. A failed-row retry is available only while the staged upload remains inside the configured TTL; after it expires, upload the source file again. All staged data and job state are removed when the adapter shuts down.

Credentials belong only in `services/solr-api/.env`:

```dotenv
SOLR_USERNAME=admin
SOLR_PASSWORD=replace-me
```

Do not commit that file.

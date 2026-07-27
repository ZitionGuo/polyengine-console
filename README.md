# PolyEngine Console

PolyEngine Console is a local operations workspace for multiple search and data engines. It combines the existing Qdrant administration tools with a Solr vector-search workbench while keeping each engine behind an independent FastAPI adapter.

The default route is an engine overview. Qdrant and Solr workflows live under separate route and API namespaces, so an unavailable engine does not block the rest of the console.

## Features

### Qdrant

- Collection runtime overview, creation, deletion, live configuration, dense/named/sparse vectors, payload indexes, point browsing, vector queries, facets, and payload operations.
- Collection and storage snapshots, restore controls, optimization activity, aliases, cluster state, and telemetry.
- REST Console with templates, local history, response metadata, and confirmation for mutating requests.

### Solr

- Plain-English semantic and hybrid search with automatic embeddings.
- Explicit topK, candidate, rerank, score-threshold, timeout, and fusion controls.
- Single-field, multi-field comparison, and weighted multi-vector fusion workflows.
- Collection schema readiness, query diagnostics, result inspection, search history, and JSON/JSONL/CSV ingestion jobs.
- English embeddings from `sentence-transformers/all-MiniLM-L6-v2`.

## Repository layout

```text
apps/
  console/              React, TypeScript, Vite, Ant Design, TanStack Query
services/
  qdrant-api/           FastAPI adapter for Qdrant
  solr-api/             FastAPI adapter for Solr and the embedding model
samples/
  solr/                 Synthetic data and multi-vector indexing scripts
docs/
  solr-vector.md        Solr vector-search notes
compose.solr.yml        Optional local SolrCloud service
```

## Requirements

- Node.js 20 or newer.
- Python 3.11 or newer.
- Qdrant available at `http://localhost:6333`.
- SolrCloud available at `http://localhost:8983/solr`.
- Network access the first time the embedding model is downloaded. Later starts use the local Hugging Face cache.

## Run locally

Create a Python environment at the repository root and install both adapters:

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/qdrant-api/requirements.txt
.venv/bin/pip install -r services/solr-api/requirements.txt
```

Start the Qdrant adapter:

```bash
cd services/qdrant-api
cp .env.example .env
../../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Start the Solr adapter in another terminal:

```bash
cd services/solr-api
cp .env.example .env
../../.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

Start the unified console:

```bash
cd apps/console
npm install
npm run dev
```

Open `http://localhost:5173/`. Vite forwards `/api/qdrant/*` to port `8000` and `/api/solr/*` to port `8010`.

An optional local SolrCloud instance is included:

```bash
docker compose -f compose.solr.yml up -d
```

## Configuration

Qdrant settings belong in `services/qdrant-api/.env`:

- `QDRANT_URL`, default `http://localhost:6333`
- `QDRANT_API_KEY`, optional and never exposed to the browser
- `CORS_ORIGINS`, optional list of allowed console origins

Solr settings belong in `services/solr-api/.env`:

- `SOLR_URL`, default `http://localhost:8983/solr`
- `SOLR_USERNAME` and `SOLR_PASSWORD`, optional Basic Auth credentials
- `EMBEDDING_MODEL`, default `sentence-transformers/all-MiniLM-L6-v2`
- `EMBEDDING_DIMENSION`, default `384`
- Search timeout, model cache, upload, and ingestion limits documented in `.env.example`

Only `.env.example` files belong in Git. Real `.env` files, credentials, caches, uploads, and model data stay local.

## Routes

- `/` engine overview
- `/qdrant/collections`, `/qdrant/aliases`, `/qdrant/cluster`, `/qdrant/rest`
- `/solr/collections`, `/solr/search`, `/solr/ingest`

Legacy `/collections`, `/aliases`, `/cluster`, `/rest`, `/search`, and `/ingest` paths redirect to their namespaced replacements.

## Solr demo data

`samples/solr/solr_vector_demo_500.jsonl` contains 500 deterministic synthetic English documents. Regenerate it with:

```bash
python3 samples/solr/generate_demo_data.py
```

After creating a compatible Solr collection with `embedding` and `embedding_title` 384-dimensional `DenseVectorField` fields, index both vectors with:

```bash
.venv/bin/python samples/solr/index_multi_vector_demo.py
```

The indexing script intentionally loads the embedding model from the local cache.

## Verification

```bash
cd services/qdrant-api
../../.venv/bin/pytest

cd ../solr-api
../../.venv/bin/pytest

cd ../../apps/console
npm run test
npm run build
```

Health checks are available through the frontend gateway at `/api/qdrant/health` and `/api/solr/health`.

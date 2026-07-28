<div align="center">

# PolyEngine Console

**One local control plane for vector databases and search engines.**

Operate Qdrant, explore Solr and Elasticsearch vector relevance, and keep each engine isolated behind a dedicated API adapter.

![React](https://img.shields.io/badge/React-18-149eca?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)
![Ant Design](https://img.shields.io/badge/Ant_Design-5-1677ff?style=flat-square&logo=antdesign&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-supported-dc244c?style=flat-square)
![Solr](https://img.shields.io/badge/Solr-supported-d9411e?style=flat-square&logo=apache-solr&logoColor=white)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-9.4.4-5b63c9?style=flat-square&logo=elasticsearch&logoColor=white)

</div>

![PolyEngine Console overview with Qdrant and Solr connected](docs/images/overview.png)

PolyEngine Console is a modular administration workspace for local search infrastructure. The default screen is an engine health overview rather than an engine-specific page. Qdrant, Solr, and Elasticsearch keep separate routes, query caches, health checks, and FastAPI processes, so one unavailable engine never blocks the others.

## Highlights

| Area | What it provides |
| --- | --- |
| **Unified workspace** | Engine overview, grouped navigation, live health indicators, responsive desktop/mobile shell, and isolated failure states. |
| **Qdrant operations** | Collections, dense/named/sparse vectors, payload indexes, points, aliases, snapshots, optimization activity, cluster telemetry, and a guarded REST console. |
| **Solr vector search** | Plain-English query embeddings, semantic and hybrid retrieval, explicit topK, multi-vector comparison and fusion, query-vector/cache inspection, diagnostics, and relevance inspection. |
| **Solr ingestion** | JSON, JSONL, and CSV uploads; independent source-text mappings for every vector field; batched embeddings; progress, cancellation, paginated error inspection, failed-row retries, and CSV exports. |
| **Elasticsearch vector search** | Mapping-driven vector discovery, Qwen3 text embeddings, `semantic_text` and inference endpoints, explicit topK/candidates, multi-vector comparison, BM25 hybrid retrieval, and weighted RRF fusion. |
| **Local-first security** | API keys and credentials stay in backend-only `.env` files. The browser communicates only with namespaced local adapters. |
| **Extensible foundation** | An engine registry and namespaced module layout are ready for future Dgraph and additional engine adapters. |

## Interface

### Solr vector search

Write a plain-English query and let the local embedding adapter build the Solr KNN request. The workbench keeps topK, vector-field selection, semantic/hybrid mode, multi-field comparison and fusion, exact query-vector inspection, score diagnostics, timing, relevance judgments, and exports in one place.

![Solr vector search results with topK scores and timing diagnostics](docs/images/solr-vector-search.png)

### Qdrant operations

Scan collection health, point and index counts, dense and sparse vector spaces, optimization activity, and lifecycle actions before drilling into vectors, payload indexes, points, aliases, snapshots, or cluster placement.

![Qdrant collection health and vector-space management](docs/images/qdrant-collections.png)

### Elasticsearch vector search

Select any discovered `dense_vector` or `semantic_text` field. Every target keeps its own local/field-native/inference provider, weight, threshold, and candidate override. Compare fields side by side or fuse them with BM25 using application-side weighted RRF on a Basic license; native Elasticsearch RRF is offered when the connected license reports support.

![Elasticsearch multi-vector search builder and results](docs/images/elasticsearch-vector-search.jpg)

Screenshots use deterministic synthetic sample data and successful API-contract fixtures; they contain no production data. At runtime, each engine has an isolated error state, so one stopped service does not block the other workflows.

## Architecture

```mermaid
flowchart LR
    Browser["React Console<br/>localhost:5173"]
    QAPI["Qdrant Adapter<br/>localhost:8000"]
    SAPI["Solr Adapter<br/>localhost:8010"]
    EAPI["Elasticsearch Adapter<br/>localhost:8020"]
    Qdrant["Qdrant<br/>localhost:6333"]
    Solr["SolrCloud<br/>localhost:8983"]
    Elasticsearch["Elasticsearch 9.4.4<br/>localhost:9200"]
    SolrModel["Sentence Transformers<br/>all-MiniLM-L6-v2"]
    ESModel["Qwen3 Embedding 0.6B<br/>384 dimensions"]

    Browser -->|"/api/qdrant/*"| QAPI
    Browser -->|"/api/solr/*"| SAPI
    Browser -->|"/api/elasticsearch/*"| EAPI
    QAPI --> Qdrant
    SAPI --> Solr
    SAPI --> SolrModel
    EAPI --> Elasticsearch
    EAPI --> ESModel
```

The React application owns navigation and presentation only. Each Python adapter owns upstream credentials, response normalization, connection pooling, and engine-specific behavior.

## Repository Layout

```text
apps/
  console/              React, TypeScript, Vite, Ant Design, TanStack Query
services/
  qdrant-api/           FastAPI adapter for Qdrant
  solr-api/             FastAPI adapter for Solr and the embedding model
  elasticsearch-api/    FastAPI adapter for Elasticsearch and Qwen3
samples/
  solr/                 500 synthetic documents and indexing utilities
  elasticsearch/        Elasticsearch demo index utility
docs/
  images/               README screenshots
  solr-vector.md        Solr vector-search behavior and compatibility
compose.solr.yml        Optional local SolrCloud service
compose.elasticsearch.yml Optional local Elasticsearch 9.4.4 service
```

## Quick Start

### Prerequisites

- Node.js 20 or newer
- Python 3.11 or newer
- Qdrant at `http://localhost:6333`
- SolrCloud at `http://localhost:8983/solr`
- Elasticsearch 9.4.4 at `http://localhost:9200`
- Network access the first time the embedding model is downloaded

Clone the repository and install dependencies:

```bash
git clone https://github.com/ZitionGuo/polyengine-console.git
cd polyengine-console

python3 -m venv .venv
.venv/bin/python -m pip install -r services/qdrant-api/requirements.txt
.venv/bin/python -m pip install -r services/solr-api/requirements.txt
.venv/bin/python -m pip install -r services/elasticsearch-api/requirements.txt

cd apps/console
npm install
cd ../..
```

Start the console and all three API adapters from the repository root:

```bash
./scripts/dev.sh
```

Open [http://localhost:5173](http://localhost:5173). Press `Ctrl+C` once to stop the console and all API adapters.

The script expects Qdrant, Solr, and Elasticsearch themselves to be running at the configured URLs. It does not start, stop, or modify the engines.

### Start services separately

Use separate terminals when debugging an individual adapter.

#### Qdrant adapter

```bash
cd services/qdrant-api
cp .env.example .env
../../.venv/bin/python -m uvicorn app.main:app \
  --reload --host 127.0.0.1 --port 8000
```

#### Solr adapter

```bash
cd services/solr-api
cp .env.example .env
../../.venv/bin/python -m uvicorn app.main:app \
  --reload --host 127.0.0.1 --port 8010
```

#### Elasticsearch adapter

```bash
cd services/elasticsearch-api
cp .env.example .env
../../.venv/bin/python -m uvicorn app.main:app \
  --reload --host 127.0.0.1 --port 8020
```

#### React console

```bash
cd apps/console
npm run dev
```

Vite forwards `/api/qdrant/*` to port `8000`, `/api/solr/*` to port `8010`, and `/api/elasticsearch/*` to port `8020`. The engines remain independent local services.

### Optional local SolrCloud

```bash
docker compose -f compose.solr.yml up -d
```

### Optional local Elasticsearch

The development Compose file pins the latest supported release, binds it only to loopback, runs one node, and disables security for local use:

```bash
docker compose -f compose.elasticsearch.yml up -d
curl http://localhost:9200
```

Do not expose this no-auth container to another host. Use Elasticsearch security and configure adapter credentials for any shared environment.

## Routes

| Route | Module |
| --- | --- |
| `/` | Engine overview |
| `/qdrant/collections` | Qdrant collections and collection details |
| `/qdrant/aliases` | Qdrant alias management |
| `/qdrant/cluster` | Cluster, telemetry, shards, and storage snapshots |
| `/qdrant/rest` | Guarded Qdrant REST console |
| `/solr/collections` | Solr schema and vector-field readiness |
| `/solr/search` | Semantic, hybrid, comparison, and fusion search |
| `/solr/ingest` | Upload and background embedding jobs |
| `/elasticsearch/indices` | Index mappings and vector-field readiness |
| `/elasticsearch/search` | Vector, hybrid, comparison, and RRF fusion search |

Legacy `/collections`, `/aliases`, `/cluster`, `/rest`, `/search`, and `/ingest` paths redirect to their namespaced replacements.

## Configuration

Real credentials belong only in local `.env` files. Those files are ignored by Git; commit only `.env.example`.

### Qdrant adapter

File: `services/qdrant-api/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant REST endpoint |
| `QDRANT_API_KEY` | empty | Optional `api-key` value sent upstream |
| `CORS_ORIGINS` | localhost console origins | Allowed browser origins |

### Solr adapter

File: `services/solr-api/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `SOLR_URL` | `http://localhost:8983/solr` | Solr base endpoint |
| `SOLR_USERNAME` | empty | Optional Basic Auth username |
| `SOLR_PASSWORD` | empty | Optional Basic Auth password |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | English embedding model |
| `EMBEDDING_DIMENSION` | `384` | Required Solr vector dimension |
| `SOLR_READ_TIMEOUT_SECONDS` | `30` | Upstream response timeout |
| `MAX_UPLOAD_MB` | `100` | Ingestion upload limit |
| `INGEST_BATCH_SIZE` | `64` | Default embedding/indexing batch size |

See [`services/solr-api/.env.example`](services/solr-api/.env.example) for cache, timeout, and ingestion settings.

### Elasticsearch adapter

File: `services/elasticsearch-api/.env`

| Variable | Default | Description |
| --- | --- | --- |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch HTTP endpoint |
| `ELASTICSEARCH_API_KEY` | empty | Optional API key; takes precedence over Basic Auth |
| `ELASTICSEARCH_USERNAME` | empty | Optional Basic Auth username |
| `ELASTICSEARCH_PASSWORD` | empty | Optional Basic Auth password |
| `ELASTICSEARCH_VERIFY_SSL` | `true` | Verify HTTPS certificates |
| `ELASTICSEARCH_CA_CERT` | empty | Optional custom CA certificate path |
| `EMBEDDING_MODEL` | `Qwen/Qwen3-Embedding-0.6B` | Local English query/document model |
| `EMBEDDING_DIMENSION` | `384` | Matryoshka-truncated vector dimension |
| `EMBEDDING_QUERY_INSTRUCTION` | web passage retrieval | Qwen query instruction |

The adapter injects credentials server-side. A selected dense vector field must match the configured local model dimension when using **Local Qwen**. Other dimensions can use a compatible Elasticsearch inference endpoint.

## Solr Demo Dataset

[`samples/solr/solr_vector_demo_500.jsonl`](samples/solr/solr_vector_demo_500.jsonl) contains 500 deterministic synthetic English operations guides.

Regenerate the file:

```bash
.venv/bin/python samples/solr/generate_demo_data.py
```

After creating a Solr collection with compatible `embedding` and `embedding_title` 384-dimensional `DenseVectorField` fields, index both vectors:

```bash
.venv/bin/python samples/solr/index_multi_vector_demo.py
```

The indexing script loads the embedding model from the local Hugging Face cache.

## Elasticsearch Demo Dataset

The Elasticsearch importer reuses the same 500 synthetic English guides and creates `polyengine_vector_demo` with independent `title_embedding` and `content_embedding` fields:

```bash
docker compose -f compose.elasticsearch.yml up -d
.venv/bin/python samples/elasticsearch/index_vector_demo.py --recreate
```

The first run downloads `Qwen/Qwen3-Embedding-0.6B`. Both fields use normalized 384-dimensional vectors and Elasticsearch `bbq_hnsw` indexing. Add `--local-files-only` to require an already cached model.

## Development

Run all automated checks:

```bash
cd services/qdrant-api
../../.venv/bin/python -m pytest

cd ../solr-api
../../.venv/bin/python -m pytest

cd ../elasticsearch-api
../../.venv/bin/python -m pytest

cd ../../apps/console
npm run test
npm run build
```

Current coverage includes Qdrant alias actions, collection/index workflows, snapshots, point operations, REST proxy safeguards, Solr embedding and ingestion behavior, Elasticsearch field/provider discovery and weighted RRF behavior, semantic/hybrid/fusion payloads, timeout and cancellation behavior, engine routing, legacy redirects, and single-engine failure isolation.

## Troubleshooting

### An engine shows `Unavailable`

Check the adapter first:

```bash
curl -i http://localhost:5173/api/qdrant/health
curl -i http://localhost:5173/api/solr/health
curl -i http://localhost:5173/api/elasticsearch/health
```

A `503` with a normalized `detail` body means the adapter is running but its upstream engine cannot be reached. Confirm Qdrant on port `6333`, Solr on port `8983`, or Elasticsearch on port `9200`.

### The Solr model is not loaded

Use **Load model** from Overview, or call:

```bash
curl -X POST http://localhost:5173/api/solr/model/load
```

The first load may download model files. Later loads use the local cache.

The Overview and Query Embedding inspector show the bounded in-memory query cache. **Clear cache** removes cached query vectors without unloading the model or deleting the Hugging Face model files.

### A Solr vector field is incompatible

The field must be a `DenseVectorField` using `FLOAT32`, and its dimension must match `EMBEDDING_DIMENSION`. The default model requires 384 dimensions. After changing a schema in Solr Admin, use **Refresh** on Collections or the schema refresh icon in Vector Search/Ingest to bypass the adapter metadata TTL immediately.

### An Elasticsearch vector field is unavailable

- `dense_vector` must have `index: true` for approximate kNN.
- **Local Qwen** requires `dims: 384`; choose **ES inference** for another compatible endpoint/dimension.
- `semantic_text` uses **Field-native** inference and must have an inference endpoint in its mapping.
- Nested vector fields are shown for diagnostics but are intentionally disabled in this release.
- Native RRF is license-gated. Application RRF provides weighted fusion on the Basic license.

### A moved virtual environment no longer starts scripts

Virtual-environment console scripts contain absolute shebang paths. Use `.venv/bin/python -m <module>` as shown above, or recreate `.venv` after moving the repository.

## Security Notes

- Qdrant API keys, Solr credentials, and Elasticsearch API keys/Basic Auth are injected by Python adapters and never returned to the browser.
- The Qdrant REST proxy accepts relative Qdrant paths only; it cannot proxy arbitrary external URLs.
- Mutating REST Console requests require confirmation.
- `.env`, virtual environments, model caches, uploads, build output, and dependency folders are excluded from Git.
- The included Solr dataset is synthetic and contains no personal or production data.
- The local Elasticsearch Compose service has security disabled and binds only to `127.0.0.1`.

## Roadmap

- Dgraph schema and graph exploration
- Elasticsearch rerankers and sparse-vector retrieval
- Shared connection profiles for multiple instances per engine
- Optional packaged local development runtime

Contributions can follow the existing engine registry, namespaced frontend module, and independent FastAPI adapter pattern.

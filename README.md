# Qdrant Local Admin

A local Qdrant management console with a FastAPI proxy backend and a React + TypeScript + Vite frontend.

## Features

- Collection list, detail drawer, creation, deletion, dense vectors, named vectors, sparse vectors, replica/shard options, on-disk payload, advanced JSON, and payload index creation/deletion. Failed post-create indexes keep the collection intact and can be inspected, edited, and retried from the UI.
- Live collection tuning for replica/write consistency, payload storage, optimizer, HNSW, metadata, and other advanced Qdrant update fields.
- Per-collection snapshot list, creation, streaming download, and deletion with size, creation time, and checksum display.
- Structured optimization activity with queue totals, running task progress, idle segments, and recent completed work.
- Point management inside collection details: scroll preview with first/previous/next navigation, JSON upsert, delete by point id, payload replacement/clearing without resending vectors, payload filter browsing, and vector query/search with score display.
- Alias list, create, rename, collection reassignment, and delete. Renaming and reassignment are submitted as one atomic Qdrant alias update.
- Cluster status, telemetry summary, and per-collection shard state. Single-node instances use collection configuration directly instead of surfacing an expected cluster-endpoint failure.
- REST console for raw Qdrant calls through the backend proxy, with common request templates, local history, upstream HTTP status/duration/response headers, response summaries, and confirmation for mutating methods.
- Backend proxy keeps Qdrant response envelopes where possible and normalizes upstream errors into a consistent `detail` shape.
- Collections, Aliases, Cluster, and REST Console are loaded on demand; production builds separate React, Ant Design, rc components, and icons into stable vendor chunks.
- Each main view has a stable URL (`/collections`, `/aliases`, `/cluster`, `/rest`) with refresh and browser history support.
- The FastAPI lifespan owns pooled normal-request and streaming `httpx` clients, reusing Qdrant connections and closing them cleanly on shutdown.

## Project layout

```text
backend/   FastAPI proxy API, Qdrant HTTP client, pytest coverage
frontend/  React + TypeScript + Vite + Ant Design + TanStack Query
```

## Run locally

Use Node 20+ LTS for the frontend. The current repository includes a Python 3.13 virtual environment path, but any compatible virtual environment is fine.

```bash
cd backend
cp .env.example .env
../.venv/bin/pip install -r requirements.txt
../.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/collections`. The frontend proxies `/api` to `http://127.0.0.1:8000`.

The backend talks to Qdrant through `QDRANT_URL` and ignores host proxy environment variables for those upstream calls, which keeps local `localhost:6333` requests from being accidentally routed through a system proxy.

## Configuration

Backend environment variables:

- `QDRANT_URL`: defaults to `http://localhost:6333`.
- `QDRANT_API_KEY`: optional Qdrant API key. When set, the backend sends it as the `api-key` header.
- `CORS_ORIGINS`: optional Pydantic settings list override if you need a different frontend origin. Example:

```bash
CORS_ORIGINS='["http://localhost:5173","http://127.0.0.1:5173"]'
```

## API surface

- `GET /api/health`
- `GET /api/collections`, `GET /api/collections/{name}`, `PUT /api/collections/{name}`, `PATCH /api/collections/{name}`, `DELETE /api/collections/{name}`
- `GET /api/collections/{name}/snapshots`, `POST /api/collections/{name}/snapshots`, `GET /api/collections/{name}/snapshots/{snapshot}`, `DELETE /api/collections/{name}/snapshots/{snapshot}`
- `GET /api/collections/{name}/optimizations`
- `PUT /api/collections/{name}/indexes`, `DELETE /api/collections/{name}/indexes/{field}`
- `POST /api/collections/{name}/points/scroll`, `POST /api/collections/{name}/points/query`, `PUT /api/collections/{name}/points`, `POST /api/collections/{name}/points/delete`
- `PUT /api/collections/{name}/points/payload`, `POST /api/collections/{name}/points/payload/clear`
- `GET /api/aliases`, `POST /api/aliases`, `PATCH /api/aliases/{old_alias}`, `DELETE /api/aliases/{alias}`
- `GET /api/cluster`, `GET /api/cluster/telemetry`, `GET /api/collections/{name}/cluster`
- `POST /api/rest`

Successful REST Console proxy calls return metadata alongside the unmodified Qdrant body:

```json
{
  "status_code": 200,
  "headers": { "content-type": "application/json" },
  "duration_ms": 12.345,
  "body": { "result": {}, "status": "ok", "time": 0.001 }
}
```

Only non-sensitive response headers are included. Upstream errors continue to use the shared `detail: { message, upstream_status, upstream_body }` error shape and the upstream HTTP status.

## Verification

```bash
cd backend
../.venv/bin/pytest

cd ../frontend
npm run test
npm run build
```

If Qdrant is reachable from the backend process, `GET /api/health` returns the upstream Qdrant root response.

For a quick local smoke test, create a temporary collection from the UI, upsert a point from the collection drawer, scroll/filter/query it, then delete the temporary collection.

# Qdrant Local Admin

A local Qdrant management console with a FastAPI proxy backend and a React + TypeScript + Vite frontend.

## Features

- Collection list, detail drawer, creation, deletion, dense vectors, named vectors, sparse vectors, replica/shard options, on-disk payload, advanced JSON, and payload index creation/deletion.
- Point management inside collection details: scroll preview, JSON upsert, delete by point id, payload filter browsing, and vector query/search with score display.
- Alias list, create, rename, and delete.
- Cluster status, telemetry summary, and per-collection shard state with single-node/disabled-cluster messaging.
- REST console for raw Qdrant calls through the backend proxy, with common request templates, local history, response summaries, and confirmation for mutating methods.
- Backend proxy keeps Qdrant response envelopes where possible and normalizes upstream errors into a consistent `detail` shape.

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

Open `http://localhost:5173`. The frontend proxies `/api` to `http://127.0.0.1:8000`.

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
- `GET /api/collections`, `GET /api/collections/{name}`, `PUT /api/collections/{name}`, `DELETE /api/collections/{name}`
- `PUT /api/collections/{name}/indexes`, `DELETE /api/collections/{name}/indexes/{field}`
- `POST /api/collections/{name}/points/scroll`, `POST /api/collections/{name}/points/query`, `PUT /api/collections/{name}/points`, `POST /api/collections/{name}/points/delete`
- `GET /api/aliases`, `POST /api/aliases`, `PATCH /api/aliases/{old_alias}`, `DELETE /api/aliases/{alias}`
- `GET /api/cluster`, `GET /api/cluster/telemetry`, `GET /api/collections/{name}/cluster`
- `POST /api/rest`

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

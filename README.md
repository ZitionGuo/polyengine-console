# Qdrant Local Admin

A local Qdrant management console with a FastAPI proxy backend and a React + TypeScript + Vite frontend.

## Features

- Collection list, detail view, creation, deletion, dense vectors, named vectors, sparse vectors, replica/shard options, advanced JSON, and payload index creation.
- Alias list, create, rename, and delete.
- Cluster status, telemetry, and per-collection shard state.
- REST console for raw Qdrant calls through the backend proxy, with confirmation for mutating methods.

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

## Configuration

Backend environment variables:

- `QDRANT_URL`: defaults to `http://localhost:6333`.
- `QDRANT_API_KEY`: optional Qdrant API key. When set, the backend sends it as the `api-key` header.
- `CORS_ORIGINS`: optional Pydantic settings list override if you need a different frontend origin.

## Verification

```bash
cd backend
../.venv/bin/pytest

cd ../frontend
npm run test
npm run build
```

If Qdrant is reachable from the backend process, `GET /api/health` returns the upstream Qdrant root response.

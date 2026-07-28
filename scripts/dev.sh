#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
CONSOLE_DIR="$ROOT_DIR/apps/console"
PIDS=()

require_file() {
  if [[ ! -e "$1" ]]; then
    printf "Missing %s\n" "$1" >&2
    printf "Run the dependency installation steps in README.md first.\n" >&2
    exit 1
  fi
}

cleanup() {
  local pid
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait "${PIDS[@]:-}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

require_file "$PYTHON_BIN"
require_file "$CONSOLE_DIR/node_modules"

(
  cd "$ROOT_DIR/services/qdrant-api"
  exec "$PYTHON_BIN" -m uvicorn app.main:app \
    --reload --host 127.0.0.1 --port 8000
) &
PIDS+=("$!")

(
  cd "$ROOT_DIR/services/solr-api"
  exec "$PYTHON_BIN" -m uvicorn app.main:app \
    --reload --host 127.0.0.1 --port 8010
) &
PIDS+=("$!")

(
  cd "$ROOT_DIR/services/elasticsearch-api"
  exec "$PYTHON_BIN" -m uvicorn app.main:app \
    --reload --host 127.0.0.1 --port 8020
) &
PIDS+=("$!")

(
  cd "$CONSOLE_DIR"
  exec npm run dev
) &
PIDS+=("$!")

printf "\nPolyEngine Console is starting:\n"
printf "  Console:     http://localhost:5173\n"
printf "  Qdrant API:  http://localhost:8000/api/health\n"
printf "  Solr API:    http://localhost:8010/api/health\n"
printf "  Elasticsearch API: http://localhost:8020/api/health\n"
printf "\nPress Ctrl+C to stop all four development processes.\n\n"

set +e
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      status=$?
      if [[ "$status" -ne 0 ]]; then
        printf "A development process exited with status %s. Stopping the remaining processes.\n" "$status" >&2
      fi
      exit "$status"
    fi
  done
  sleep 1
done

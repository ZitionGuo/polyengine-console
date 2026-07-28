import argparse
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from sentence_transformers import SentenceTransformer


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT_DIR / "samples" / "solr" / "solr_vector_demo_500.jsonl"


def read_documents(path: Path) -> list[dict[str, Any]]:
    documents = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not documents:
        raise RuntimeError("The input file contains no documents.")
    return documents


def auth_headers(api_key: str | None) -> dict[str, str]:
    return {"Authorization": f"ApiKey {api_key}"} if api_key else {}


def index_mapping(dimension: int) -> dict[str, Any]:
    vector_definition = {
        "type": "dense_vector",
        "dims": dimension,
        "index": True,
        "similarity": "cosine",
        "index_options": {"type": "bbq_hnsw"},
    }
    return {
        "settings": {"number_of_shards": 1, "number_of_replicas": 0},
        "mappings": {
            "dynamic": "strict",
            "properties": {
                "id": {"type": "keyword"},
                "title": {"type": "text"},
                "body": {"type": "text"},
                "category": {"type": "keyword"},
                "source": {"type": "keyword"},
                "year": {"type": "integer"},
                "tags": {"type": "keyword"},
                "title_embedding": vector_definition,
                "content_embedding": vector_definition,
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create an Elasticsearch vector demo index with 500 synthetic documents."
    )
    parser.add_argument("--elasticsearch-url", default="http://127.0.0.1:9200")
    parser.add_argument("--index", default="polyengine_vector_demo")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--model", default="Qwen/Qwen3-Embedding-0.6B")
    parser.add_argument("--dimension", type=int, default=384)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--api-key")
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--local-files-only", action="store_true")
    parser.add_argument("--recreate", action="store_true")
    args = parser.parse_args()

    documents = read_documents(args.source)
    model = SentenceTransformer(
        args.model,
        truncate_dim=args.dimension,
        local_files_only=args.local_files_only,
    )
    title_texts = [str(document["title"]) for document in documents]
    content_texts = [
        f"{document['title']}\n\n{document['body']}" for document in documents
    ]
    title_vectors = model.encode(
        title_texts,
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    content_vectors = model.encode(
        content_texts,
        batch_size=args.batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    endpoint = args.elasticsearch_url.rstrip("/")
    encoded_index = quote(args.index, safe="")
    auth = (args.username, args.password or "") if args.username else None
    with httpx.Client(
        timeout=180,
        trust_env=False,
        auth=auth,
        headers=auth_headers(args.api_key),
    ) as client:
        root = client.get(endpoint)
        root.raise_for_status()
        version = root.json().get("version", {}).get("number", "unknown")

        if args.recreate:
            response = client.delete(f"{endpoint}/{encoded_index}")
            if response.status_code not in {200, 404}:
                response.raise_for_status()

        create = client.put(
            f"{endpoint}/{encoded_index}",
            json=index_mapping(args.dimension),
        )
        if create.status_code == 400 and not args.recreate:
            error_type = create.json().get("error", {}).get("type")
            if error_type != "resource_already_exists_exception":
                create.raise_for_status()
        else:
            create.raise_for_status()

        for start in range(0, len(documents), args.batch_size):
            lines: list[str] = []
            stop = min(start + args.batch_size, len(documents))
            for position in range(start, stop):
                document = {
                    **documents[position],
                    "title_embedding": title_vectors[position].astype(float).tolist(),
                    "content_embedding": content_vectors[position].astype(float).tolist(),
                }
                lines.append(
                    json.dumps(
                        {"index": {"_index": args.index, "_id": document["id"]}},
                        separators=(",", ":"),
                    )
                )
                lines.append(json.dumps(document, separators=(",", ":")))
            response = client.post(
                f"{endpoint}/_bulk",
                content="\n".join(lines) + "\n",
                headers={"Content-Type": "application/x-ndjson", **auth_headers(args.api_key)},
            )
            response.raise_for_status()
            body = response.json()
            if body.get("errors"):
                failures = [
                    item
                    for entry in body.get("items", [])
                    for item in entry.values()
                    if item.get("error")
                ]
                raise RuntimeError(f"Bulk indexing failed: {failures[:3]}")

        client.post(f"{endpoint}/{encoded_index}/_refresh").raise_for_status()

    print(
        f"Indexed {len(documents)} documents into {args.index} on Elasticsearch {version} "
        f"with title_embedding and content_embedding ({args.dimension} dimensions)."
    )


if __name__ == "__main__":
    main()

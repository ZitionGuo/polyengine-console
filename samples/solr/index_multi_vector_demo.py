import argparse
import json
from pathlib import Path
from urllib.parse import quote

import httpx
from sentence_transformers import SentenceTransformer


def read_documents(path: Path) -> list[dict[str, object]]:
    documents = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not documents:
        raise RuntimeError("The input file contains no documents.")
    return documents


def main() -> None:
    parser = argparse.ArgumentParser(description="Index the Solr demo with body and title vector fields.")
    parser.add_argument("--solr-url", default="http://127.0.0.1:8983/solr")
    parser.add_argument("--collection", default="solr_vector_demo_500")
    parser.add_argument("--model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()

    source = Path(__file__).with_name("solr_vector_demo_500.jsonl")
    documents = read_documents(source)
    model = SentenceTransformer(args.model, local_files_only=True)
    combined_texts = [f"{item['title']}\n\n{item['body']}" for item in documents]
    title_texts = [str(item["title"]) for item in documents]
    combined_vectors = model.encode(combined_texts, normalize_embeddings=True, show_progress_bar=True)
    title_vectors = model.encode(title_texts, normalize_embeddings=True, show_progress_bar=True)

    endpoint = f"{args.solr_url.rstrip('/')}/{quote(args.collection, safe='')}/update"
    with httpx.Client(timeout=120, trust_env=False) as client:
        for start in range(0, len(documents), args.batch_size):
            batch = []
            for index in range(start, min(start + args.batch_size, len(documents))):
                batch.append(
                    {
                        **documents[index],
                        "embedding": combined_vectors[index].astype(float).tolist(),
                        "embedding_title": title_vectors[index].astype(float).tolist(),
                    }
                )
            response = client.post(
                endpoint,
                params={"commitWithin": 1000, "overwrite": "true", "wt": "json"},
                json=batch,
            )
            response.raise_for_status()
        response = client.post(endpoint, params={"wt": "json"}, json={"commit": {}})
        response.raise_for_status()

    print(f"Indexed {len(documents)} documents with embedding and embedding_title.")


if __name__ == "__main__":
    main()

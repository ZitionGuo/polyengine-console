import json
from pathlib import Path


CATEGORIES = {
    "deployment": ("deployment", "release automation", "rollout", "rollback", "health checks"),
    "schema": ("schema", "field migration", "compatibility", "backfill", "aliases"),
    "indexing": ("indexing", "batch ingestion", "commits", "segment merging", "throughput"),
    "vector-search": ("vector search", "embeddings", "top K", "reranking", "similarity"),
    "relevance": ("relevance", "BM25", "boosting", "query analysis", "evaluation"),
    "operations": ("operations", "SolrCloud", "replicas", "shards", "cluster maintenance"),
    "backup": ("backup", "snapshots", "restore testing", "repositories", "recovery"),
    "observability": ("observability", "metrics", "tracing", "slow queries", "alerting"),
    "security": ("security", "authentication", "authorization", "TLS", "audit logs"),
    "performance": ("performance", "caching", "memory", "latency", "capacity planning"),
}

SCENARIOS = [
    ("Production checklist", "Build a repeatable checklist for {topic} before a production change."),
    ("Incident response", "Diagnose a live incident involving {topic} while limiting customer impact."),
    ("Capacity review", "Review capacity assumptions for {topic} and prepare for traffic growth."),
    ("Migration guide", "Migrate an existing workload with careful attention to {topic}."),
    ("Reliability pattern", "Apply a reliability pattern that makes {topic} safer to operate."),
    ("Troubleshooting playbook", "Use a step-by-step playbook to troubleshoot {topic}."),
    ("Automation recipe", "Automate repetitive work around {topic} with verifiable checkpoints."),
    ("Design review", "Evaluate design tradeoffs and failure modes related to {topic}."),
    ("Testing strategy", "Create a testing strategy that validates {topic} before release."),
    ("Optimization notes", "Measure and optimize {topic} using evidence from real workloads."),
]

VARIANTS = [
    "Start with a small canary, capture a baseline, and define a rollback threshold before changing production.",
    "Prefer observable, reversible steps and record the result of every validation gate for later review.",
    "Test under realistic load, compare multiple configurations, and document assumptions that affect the outcome.",
    "Separate retrieval quality from system latency so each can be tuned and evaluated independently.",
    "Use automation for repeatability, but keep explicit safeguards for destructive or expensive operations.",
]


def build_documents() -> list[dict[str, object]]:
    documents: list[dict[str, object]] = []
    for category_index, (category, terms) in enumerate(CATEGORIES.items()):
        topic, *keywords = terms
        for scenario_index, (scenario, prompt) in enumerate(SCENARIOS):
            for variant_index, guidance in enumerate(VARIANTS):
                number = len(documents) + 1
                focus = keywords[(scenario_index + variant_index) % len(keywords)]
                documents.append(
                    {
                        "id": f"solr-guide-{number:04d}",
                        "title": f"{scenario}: {topic} and {focus}",
                        "body": (
                            f"{prompt.format(topic=topic)} The primary focus is {focus}. "
                            f"{guidance} This synthetic guide is example {number} of 500."
                        ),
                        "category": category,
                        "source": "synthetic-solr-vector-demo",
                        "year": 2022 + ((category_index + scenario_index + variant_index) % 5),
                        "tags": [topic, focus, scenario.lower().replace(" ", "-")],
                    }
                )
    return documents


def main() -> None:
    target = Path(__file__).with_name("solr_vector_demo_500.jsonl")
    documents = build_documents()
    if len(documents) != 500 or len({item["id"] for item in documents}) != 500:
        raise RuntimeError("The generator must produce exactly 500 unique documents.")
    target.write_text(
        "".join(json.dumps(document, ensure_ascii=True) + "\n" for document in documents),
        encoding="utf-8",
    )
    print(f"Wrote {len(documents)} documents to {target}")


if __name__ == "__main__":
    main()

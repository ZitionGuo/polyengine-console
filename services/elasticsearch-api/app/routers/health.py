from typing import Any

from fastapi import APIRouter, Depends

from ..elasticsearch import ElasticsearchClient, get_elasticsearch_client
from ..embeddings import EmbeddingService, get_embedding_service


router = APIRouter(tags=["health"])


def _version_tuple(value: str) -> tuple[int, int, int]:
    parts = value.split("-", 1)[0].split(".")
    numbers = [int(part) if part.isdigit() else 0 for part in parts[:3]]
    return tuple((numbers + [0, 0, 0])[:3])  # type: ignore[return-value]


async def _license_capabilities(client: ElasticsearchClient) -> dict[str, Any]:
    try:
        body = await client.request("GET", "/_license")
    except Exception:  # noqa: BLE001 - license lookup is best effort
        return {"type": "unknown", "native_rrf": False, "inference": False}
    license_info = body.get("license", {}) if isinstance(body, dict) else {}
    license_type = str(license_info.get("type", "unknown")).lower()
    commercial = license_type in {"trial", "platinum", "enterprise"}
    return {
        "type": license_type,
        "status": license_info.get("status"),
        "native_rrf": commercial,
        "inference": commercial,
    }


@router.get("/health")
async def health(
    client: ElasticsearchClient = Depends(get_elasticsearch_client),
    embeddings: EmbeddingService = Depends(get_embedding_service),
):
    root = await client.request("GET", "/")
    cluster = await client.request("GET", "/_cluster/health")
    version = str(root.get("version", {}).get("number", "0.0.0"))
    return {
        "status": "ok" if _version_tuple(version) >= (9, 4, 0) else "unsupported",
        "elasticsearch": {
            "version": version,
            "cluster_name": root.get("cluster_name"),
            "cluster_uuid": root.get("cluster_uuid"),
            "health": cluster.get("status"),
            "nodes": cluster.get("number_of_nodes"),
            "endpoint": str(client.settings.elasticsearch_url).rstrip("/"),
        },
        "capabilities": await _license_capabilities(client),
        "model": embeddings.status(),
    }

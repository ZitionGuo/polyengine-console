from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..elasticsearch import ElasticsearchClient, get_elasticsearch_client


router = APIRouter(prefix="/inference", tags=["inference"])


def _normalize_endpoints(body: Any) -> list[dict[str, Any]]:
    endpoints: list[dict[str, Any]] = []
    items = body.get("endpoints", body) if isinstance(body, dict) else body
    if not isinstance(items, list):
        return endpoints
    for item in items:
        if not isinstance(item, dict):
            continue
        endpoint_id = item.get("inference_id") or item.get("inference_endpoint_id")
        task_type = item.get("task_type")
        if not endpoint_id or task_type not in {"text_embedding", "any"}:
            continue
        service = item.get("service") or item.get("service_settings", {}).get("service")
        endpoints.append(
            {
                "id": endpoint_id,
                "task_type": task_type,
                "service": service,
            }
        )
    return endpoints


@router.get("/endpoints")
async def inference_endpoints(
    client: ElasticsearchClient = Depends(get_elasticsearch_client),
):
    try:
        body = await client.request("GET", "/_inference/_all")
    except HTTPException as exc:
        if exc.status_code in {400, 403, 404}:
            return {
                "available": False,
                "endpoints": [],
                "error": exc.detail,
            }
        raise
    return {
        "available": True,
        "endpoints": _normalize_endpoints(body),
    }

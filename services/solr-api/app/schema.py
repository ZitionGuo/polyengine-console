from typing import Any

from fastapi import HTTPException

from .solr import SolrClient


def require_vector_field(
    schema: dict[str, Any],
    vector_field: str,
    *,
    expected_dimension: int,
) -> None:
    vector = next(
        (field for field in schema["vector_fields"] if field["name"] == vector_field),
        None,
    )
    if vector is None:
        raise HTTPException(
            status_code=422,
            detail={"message": f"Field '{vector_field}' is not a DenseVectorField."},
        )
    if vector.get("dimension") != expected_dimension:
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    f"Field '{vector_field}' has dimension {vector.get('dimension')}; "
                    f"the configured model requires {expected_dimension}."
                )
            },
        )
    if vector.get("vector_encoding") != "FLOAT32":
        raise HTTPException(
            status_code=422,
            detail={"message": f"Field '{vector_field}' must use FLOAT32 vector encoding."},
        )


async def require_collection_schema(
    client: SolrClient,
    collection: str,
    *,
    expected_dimension: int,
    vector_field: str,
    lexical_fields: list[str] | None = None,
    return_fields: list[str] | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    names = await client.list_collection_names(timeout_seconds=timeout_seconds)
    if collection not in names:
        raise HTTPException(status_code=404, detail={"message": f"Collection '{collection}' was not found."})

    schema = await client.collection_schema(collection, timeout_seconds=timeout_seconds)
    all_names = {field["name"] for field in schema["fields"]}
    require_vector_field(schema, vector_field, expected_dimension=expected_dimension)

    requested = [*(lexical_fields or []), *(return_fields or [])]
    missing = sorted({name for name in requested if name != "score" and name not in all_names})
    if missing:
        raise HTTPException(
            status_code=422,
            detail={"message": f"Unknown schema fields: {', '.join(missing)}."},
        )
    return schema

from typing import Any


TEXT_TYPES = {"text", "match_only_text", "keyword", "wildcard"}
VECTOR_TYPES = {"dense_vector", "semantic_text"}


def flatten_mapping(
    properties: dict[str, Any],
    *,
    model_dimension: int,
    prefix: str = "",
    inside_nested: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    fields: list[dict[str, Any]] = []
    text_fields: list[dict[str, Any]] = []
    vector_fields: list[dict[str, Any]] = []

    for name, definition in properties.items():
        if not isinstance(definition, dict):
            continue
        path = f"{prefix}.{name}" if prefix else name
        field_type = definition.get("type", "object")
        current_nested = inside_nested or field_type == "nested"
        field = {
            "name": path,
            "type": field_type,
            "indexed": definition.get("index", True),
        }
        fields.append(field)

        if field_type in TEXT_TYPES:
            text_fields.append(field)
        if field_type in VECTOR_TYPES:
            reason: str | None = None
            if current_nested:
                reason = "Nested vector fields are not supported in this release."
            elif field_type == "dense_vector" and not definition.get("index", True):
                reason = "The dense vector field is not indexed for approximate kNN search."
            dims = definition.get("dims")
            local_compatible = field_type == "dense_vector" and dims == model_dimension and reason is None
            inference_id = definition.get("search_inference_id") or definition.get("inference_id")
            if field_type == "semantic_text" and not inference_id and reason is None:
                reason = "The semantic_text field has no inference endpoint."
            vector_fields.append(
                {
                    **field,
                    "dimension": dims,
                    "similarity": definition.get("similarity", "cosine"),
                    "element_type": definition.get("element_type", "float"),
                    "index_options": definition.get("index_options") or {},
                    "inference_id": inference_id,
                    "local_compatible": local_compatible,
                    "compatible": reason is None,
                    "reason": reason,
                }
            )

        children = definition.get("properties")
        if isinstance(children, dict):
            nested = flatten_mapping(
                children,
                model_dimension=model_dimension,
                prefix=path,
                inside_nested=current_nested,
            )
            fields.extend(nested["fields"])
            text_fields.extend(nested["text_fields"])
            vector_fields.extend(nested["vector_fields"])

    return {
        "fields": fields,
        "text_fields": text_fields,
        "vector_fields": vector_fields,
    }


def parse_index_mapping(
    index: str,
    response: dict[str, Any],
    *,
    model_dimension: int,
) -> dict[str, Any]:
    root = response.get(index)
    if root is None and len(response) == 1:
        root = next(iter(response.values()))
    root = root if isinstance(root, dict) else {}
    mappings = root.get("mappings") if isinstance(root.get("mappings"), dict) else {}
    properties = mappings.get("properties") if isinstance(mappings.get("properties"), dict) else {}
    flattened = flatten_mapping(properties, model_dimension=model_dimension)
    return {"index": index, **flattened}

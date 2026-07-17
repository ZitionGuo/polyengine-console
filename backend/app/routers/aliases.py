from fastapi import APIRouter, Depends

from ..models import AliasCreateRequest, AliasUpdateRequest
from ..qdrant import QdrantClient, get_qdrant_client

router = APIRouter(prefix="/aliases", tags=["aliases"])


@router.get("")
async def list_aliases(client: QdrantClient = Depends(get_qdrant_client)):
    return await client.request("GET", "/aliases")


@router.post("")
async def create_alias(
    payload: AliasCreateRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        "/collections/aliases",
        json={
            "actions": [
                {
                    "create_alias": {
                        "collection_name": payload.collection_name,
                        "alias_name": payload.alias_name,
                    }
                }
            ]
        },
    )


@router.patch("/{old_alias}")
async def update_alias(
    old_alias: str,
    payload: AliasUpdateRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    if payload.collection_name is not None:
        target_alias = payload.new_alias_name or old_alias
        actions = [
            {"delete_alias": {"alias_name": old_alias}},
            {
                "create_alias": {
                    "collection_name": payload.collection_name,
                    "alias_name": target_alias,
                }
            },
        ]
    else:
        actions = [
            {
                "rename_alias": {
                    "old_alias_name": old_alias,
                    "new_alias_name": payload.new_alias_name,
                }
            }
        ]

    return await client.request(
        "POST",
        "/collections/aliases",
        json={"actions": actions},
    )


@router.delete("/{alias_name}")
async def delete_alias(
    alias_name: str,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        "/collections/aliases",
        json={"actions": [{"delete_alias": {"alias_name": alias_name}}]},
    )

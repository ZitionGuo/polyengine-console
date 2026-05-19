from fastapi import APIRouter, Depends

from ..models import AliasCreateRequest, AliasRenameRequest
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
async def rename_alias(
    old_alias: str,
    payload: AliasRenameRequest,
    client: QdrantClient = Depends(get_qdrant_client),
):
    return await client.request(
        "POST",
        "/collections/aliases",
        json={
            "actions": [
                {
                    "rename_alias": {
                        "old_alias_name": old_alias,
                        "new_alias_name": payload.new_alias_name,
                    }
                }
            ]
        },
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

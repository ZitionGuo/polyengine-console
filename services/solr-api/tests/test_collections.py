import pytest

from app.routers.collections import collection_schema, list_collections


class FakeEmbeddings:
    dimension = 384


class FakeSolr:
    def __init__(self, names=None):
        self.names = names or []
        self.invalidations = []

    def invalidate_metadata_cache(self, collection=None):
        self.invalidations.append(collection)

    async def list_collection_names(self):
        return self.names

    async def collection_schema(self, collection):
        return {
            "collection": collection,
            "unique_key": "id",
            "fields": [{"name": "id"}],
            "text_fields": [{"name": "id"}],
            "vector_fields": [{
                "name": "embedding",
                "dimension": 384,
                "vector_encoding": "FLOAT32",
            }],
        }


@pytest.mark.anyio
async def test_collection_refresh_invalidates_all_metadata_before_loading():
    solr = FakeSolr()

    result = await list_collections(
        refresh=True,
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert solr.invalidations == [None]
    assert result == {"collections": [], "model_dimension": 384}


@pytest.mark.anyio
async def test_schema_refresh_invalidates_only_the_selected_collection():
    solr = FakeSolr(["docs"])

    result = await collection_schema(
        "docs",
        refresh=True,
        solr=solr,
        embeddings=FakeEmbeddings(),
    )

    assert solr.invalidations == ["docs"]
    assert result["vector_fields"][0]["compatible"] is True

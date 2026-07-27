import asyncio
from io import BytesIO

import pytest
from fastapi import UploadFile

from app.config import Settings
from app.jobs import IngestManager
from app.models import IngestJobCreateRequest


class FakeEmbeddings:
    dimension = 384

    async def encode(self, texts):
        return [[1.0] + [0.0] * 383 for _ in texts], 1.0


class FakeSolr:
    def __init__(self):
        self.writes = []

    async def list_collection_names(self, **kwargs):
        return ["docs"]

    async def collection_schema(self, collection, **kwargs):
        return {
            "fields": [
                {"name": "id"},
                {"name": "title"},
                {"name": "embedding"},
            ],
            "vector_fields": [
                {"name": "embedding", "dimension": 384, "vector_encoding": "FLOAT32"}
            ],
        }

    async def request(self, method, path, **kwargs):
        self.writes.append(kwargs["json"])
        return {"responseHeader": {"status": 0}}


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("filename", "content", "expected_format"),
    [
        ("docs.json", b'[{"id":"1","title":"One"}]', "json"),
        ("docs.jsonl", b'{"id":"1","title":"One"}\n', "jsonl"),
        ("docs.csv", b"id,title\n1,One\n", "csv"),
    ],
)
async def test_upload_preview_supports_json_jsonl_and_csv(tmp_path, filename, content, expected_format):
    manager = IngestManager(
        Settings(_env_file=None, max_upload_mb=1),
        FakeSolr(),
        FakeEmbeddings(),
        temp_root=tmp_path,
    )
    result = await manager.save_upload(UploadFile(filename=filename, file=BytesIO(content)), "auto")
    assert result["format"] == expected_format
    assert result["fields"] == ["id", "title"]
    assert result["total"] == 1
    await manager.close()


@pytest.mark.anyio
async def test_ingest_job_tracks_success_and_row_errors(tmp_path):
    solr = FakeSolr()
    manager = IngestManager(
        Settings(_env_file=None, ingest_batch_size=2),
        solr,
        FakeEmbeddings(),
        temp_root=tmp_path,
    )
    upload = await manager.save_upload(
        UploadFile(
            filename="docs.jsonl",
            file=BytesIO(b'{"id":"1","title":"One"}\n{"id":"2","title":""}\n'),
        ),
        "auto",
    )
    created = await manager.create_job(
        IngestJobCreateRequest(
            upload_id=upload["upload_id"],
            collection="docs",
            id_field="id",
            text_fields=["title"],
            vector_field="embedding",
            batch_size=2,
        )
    )
    for _ in range(100):
        job = manager.get_job(created["id"])
        if job.status in {"completed", "failed", "cancelled"}:
            break
        await asyncio.sleep(0.01)

    assert job.status == "completed"
    assert job.processed == 2
    assert job.succeeded == 1
    assert job.failed == 1
    assert len(solr.writes) == 1
    assert len(solr.writes[0][0]["embedding"]) == 384
    assert job.errors[0].row == 2
    await manager.close()

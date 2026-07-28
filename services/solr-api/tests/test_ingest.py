import asyncio
from io import BytesIO

import pytest
from fastapi import UploadFile
from pydantic import ValidationError

from app.config import Settings
from app.jobs import IngestManager
from app.models import IngestJobCreateRequest


class FakeEmbeddings:
    dimension = 384

    def __init__(self):
        self.calls = []

    async def encode(self, texts):
        self.calls.append(texts)
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
                {"name": "content"},
                {"name": "embedding"},
                {"name": "embedding_title"},
            ],
            "vector_fields": [
                {"name": "embedding", "dimension": 384, "vector_encoding": "FLOAT32"},
                {"name": "embedding_title", "dimension": 384, "vector_encoding": "FLOAT32"},
            ],
        }

    async def request(self, method, path, **kwargs):
        self.writes.append(kwargs["json"])
        return {"responseHeader": {"status": 0}}


class TransientRowFailureSolr(FakeSolr):
    def __init__(self):
        super().__init__()
        self.failed_once = False

    async def request(self, method, path, **kwargs):
        documents = kwargs["json"]
        if documents[0]["id"] == "2" and not self.failed_once:
            self.failed_once = True
            raise RuntimeError("Temporary Solr update failure.")
        return await super().request(method, path, **kwargs)


async def wait_for_job(manager: IngestManager, job_id: str):
    for _ in range(100):
        job = manager.get_job(job_id)
        if job.status in {"completed", "failed", "cancelled"}:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError("Ingest job did not finish.")


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
    job = await wait_for_job(manager, created["id"])

    assert job.status == "completed"
    assert job.processed == 2
    assert job.succeeded == 1
    assert job.failed == 1
    assert len(solr.writes) == 1
    assert len(solr.writes[0][0]["embedding"]) == 384
    assert job.errors[0].row == 2
    await manager.close()


@pytest.mark.anyio
async def test_ingest_job_writes_multiple_vector_targets_in_one_update(tmp_path):
    solr = FakeSolr()
    embeddings = FakeEmbeddings()
    manager = IngestManager(
        Settings(_env_file=None, ingest_batch_size=2),
        solr,
        embeddings,
        temp_root=tmp_path,
    )
    upload = await manager.save_upload(
        UploadFile(
            filename="docs.jsonl",
            file=BytesIO(
                b'{"id":"1","title":"Schema migration","content":"Roll out aliases safely."}\n'
            ),
        ),
        "auto",
    )
    created = await manager.create_job(
        IngestJobCreateRequest(
            upload_id=upload["upload_id"],
            collection="docs",
            id_field="id",
            vector_targets=[
                {"vector_field": "embedding", "text_fields": ["title", "content"]},
                {"vector_field": "embedding_title", "text_fields": ["title"]},
            ],
            batch_size=2,
        )
    )
    job = await wait_for_job(manager, created["id"])

    assert job.status == "completed"
    assert created["vector_targets"] == [
        {"vector_field": "embedding", "text_fields": ["title", "content"]},
        {"vector_field": "embedding_title", "text_fields": ["title"]},
    ]
    assert embeddings.calls == [
        ["Schema migration\n\nRoll out aliases safely."],
        ["Schema migration"],
    ]
    assert len(solr.writes) == 1
    document = solr.writes[0][0]
    assert len(document["embedding"]) == 384
    assert len(document["embedding_title"]) == 384
    await manager.close()


@pytest.mark.anyio
async def test_retry_job_processes_only_failed_source_rows(tmp_path):
    solr = TransientRowFailureSolr()
    manager = IngestManager(
        Settings(_env_file=None, ingest_batch_size=1),
        solr,
        FakeEmbeddings(),
        temp_root=tmp_path,
    )
    upload = await manager.save_upload(
        UploadFile(
            filename="docs.jsonl",
            file=BytesIO(
                b'{"id":"1","title":"One"}\n'
                b'{"id":"2","title":"Two"}\n'
                b'{"id":"3","title":"Three"}\n'
            ),
        ),
        "auto",
    )
    created = await manager.create_job(
        IngestJobCreateRequest(
            upload_id=upload["upload_id"],
            collection="docs",
            id_field="id",
            vector_field="embedding",
            text_fields=["title"],
            batch_size=1,
        )
    )
    source = await wait_for_job(manager, created["id"])

    assert source.status == "completed"
    assert source.succeeded == 2
    assert source.failed == 1
    assert source.failed_rows == {2}
    assert source.as_dict()["retryable_rows"] == 1

    retried = await manager.retry_job(source.id)
    retry = await wait_for_job(manager, retried["id"])

    assert retried["retry_of"] == source.id
    assert retried["total"] == 1
    assert retry.status == "completed"
    assert retry.succeeded == 1
    assert retry.failed == 0
    assert [
        document["id"]
        for write in solr.writes
        for document in write
    ] == ["1", "3", "2"]
    await manager.close()


def test_ingest_request_normalizes_legacy_target_and_rejects_duplicates():
    legacy = IngestJobCreateRequest(
        upload_id="upload",
        collection="docs",
        id_field="id",
        vector_field="embedding",
        text_fields=["title", "title"],
    )
    assert [target.model_dump() for target in legacy.vector_targets] == [
        {"vector_field": "embedding", "text_fields": ["title"]}
    ]

    with pytest.raises(ValidationError, match="Vector fields may be mapped only once"):
        IngestJobCreateRequest(
            upload_id="upload",
            collection="docs",
            id_field="id",
            vector_targets=[
                {"vector_field": "embedding", "text_fields": ["title"]},
                {"vector_field": "embedding", "text_fields": ["content"]},
            ],
        )

import asyncio
import csv
import json
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from .config import Settings
from .embeddings import EmbeddingService
from .models import IngestJobCreateRequest
from .schema import require_collection_schema, require_vector_field
from .solr import SolrClient


SUPPORTED_FORMATS = {"json", "jsonl", "csv"}


def _now() -> datetime:
    return datetime.now(UTC)


def _error_message(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and detail.get("message"):
            return str(detail["message"])
        return str(detail)
    return str(exc)


def _parse_records(path: Path, file_format: str) -> list[dict[str, Any]]:
    if file_format == "json":
        with path.open("r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise ValueError("JSON uploads must contain an array of objects.")
        return value
    if file_format == "jsonl":
        records: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8-sig") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError(f"JSONL line {line_number} is not an object.")
                records.append(value)
        return records
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


@dataclass
class UploadRecord:
    id: str
    path: Path
    filename: str
    file_format: str
    size: int
    fields: list[str]
    preview: list[dict[str, Any]]
    total: int
    created_at: datetime = field(default_factory=_now)

    def as_dict(self, ttl_hours: int) -> dict[str, Any]:
        return {
            "upload_id": self.id,
            "filename": self.filename,
            "format": self.file_format,
            "size": self.size,
            "fields": self.fields,
            "preview": self.preview,
            "total": self.total,
            "expires_at": (self.created_at + timedelta(hours=ttl_hours)).isoformat(),
        }


@dataclass
class IngestError:
    row: int
    document_id: str
    message: str


@dataclass
class IngestJob:
    id: str
    config: IngestJobCreateRequest
    filename: str
    source_rows: tuple[int, ...] | None = None
    retry_of: str | None = None
    status: str = "queued"
    total: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    errors: list[IngestError] = field(default_factory=list)
    failed_rows: set[int] = field(default_factory=set)
    cancel_requested: bool = False
    created_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    def as_dict(self) -> dict[str, Any]:
        elapsed = None
        if self.started_at:
            end = self.finished_at or _now()
            elapsed = max((end - self.started_at).total_seconds(), 0.001)
        return {
            "id": self.id,
            "collection": self.config.collection,
            "filename": self.filename,
            "vector_targets": [
                target.model_dump()
                for target in self.config.vector_targets
            ],
            "retry_of": self.retry_of,
            "retryable_rows": len(self.failed_rows) or (
                self.failed if self.status in {"completed", "failed", "cancelled"} else 0
            ),
            "status": self.status,
            "total": self.total,
            "processed": self.processed,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "throughput": round(self.processed / elapsed, 2) if elapsed else None,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
        }


class IngestManager:
    def __init__(
        self,
        settings: Settings,
        solr: SolrClient,
        embeddings: EmbeddingService,
        temp_root: Path | None = None,
    ):
        self.settings = settings
        self.solr = solr
        self.embeddings = embeddings
        self.root = temp_root or Path(tempfile.mkdtemp(prefix="solr-vector-admin-"))
        self.root.mkdir(parents=True, exist_ok=True)
        self.uploads: dict[str, UploadRecord] = {}
        self.jobs: dict[str, IngestJob] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._worker = asyncio.Semaphore(1)

    async def close(self) -> None:
        for task in self._tasks.values():
            if not task.done():
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        await asyncio.to_thread(shutil.rmtree, self.root, True)

    async def save_upload(self, upload: UploadFile, requested_format: str | None) -> dict[str, Any]:
        await self.cleanup_expired()
        filename = (upload.filename or "documents.jsonl").replace("\\", "/").rsplit("/", 1)[-1]
        file_format = self._resolve_format(filename, requested_format)
        upload_id = uuid4().hex
        path = self.root / f"{upload_id}.{file_format}"
        max_bytes = self.settings.max_upload_mb * 1024 * 1024
        size = 0
        try:
            with path.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail={"message": f"Upload exceeds the {self.settings.max_upload_mb} MB limit."},
                        )
                    target.write(chunk)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()

        try:
            records = await asyncio.to_thread(_parse_records, path, file_format)
        except Exception as exc:
            path.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail={"message": _error_message(exc)}) from exc
        if not records:
            path.unlink(missing_ok=True)
            raise HTTPException(status_code=422, detail={"message": "The upload contains no documents."})

        fields = sorted({str(key) for record in records[:100] for key in record})
        item = UploadRecord(
            id=upload_id,
            path=path,
            filename=filename,
            file_format=file_format,
            size=size,
            fields=fields,
            preview=records[:20],
            total=len(records),
        )
        self.uploads[upload_id] = item
        return item.as_dict(self.settings.upload_ttl_hours)

    async def create_job(self, config: IngestJobCreateRequest) -> dict[str, Any]:
        await self.cleanup_expired()
        upload = self.uploads.get(config.upload_id)
        if upload is None:
            raise HTTPException(status_code=404, detail={"message": "Upload was not found or has expired."})
        await self._validate_job(config, upload)
        return self._enqueue_job(config, upload)

    async def retry_job(self, job_id: str) -> dict[str, Any]:
        await self.cleanup_expired()
        source = self.get_job(job_id)
        if source.status in {"queued", "running"}:
            raise HTTPException(status_code=409, detail={"message": "Wait for the ingest job to finish before retrying."})
        if not source.failed:
            raise HTTPException(status_code=409, detail={"message": "This ingest job has no failed rows to retry."})
        upload = self.uploads.get(source.config.upload_id)
        if upload is None:
            raise HTTPException(
                status_code=410,
                detail={"message": "The source upload has expired. Upload the file again to retry."},
            )
        retry_rows = tuple(
            sorted(
                source.failed_rows
                or set(source.source_rows or range(1, upload.total + 1))
            )
        )
        await self._validate_job(source.config, upload)
        return self._enqueue_job(
            source.config.model_copy(deep=True),
            upload,
            source_rows=retry_rows,
            retry_of=source.id,
        )

    async def _validate_job(
        self,
        config: IngestJobCreateRequest,
        upload: UploadRecord,
    ) -> None:
        text_fields = list(
            dict.fromkeys(
                field_name
                for target in config.vector_targets
                for field_name in target.text_fields
            )
        )
        first_target = config.vector_targets[0]
        schema = await require_collection_schema(
            self.solr,
            config.collection,
            expected_dimension=self.embeddings.dimension,
            vector_field=first_target.vector_field,
            return_fields=[config.id_field, *text_fields],
        )
        for target in config.vector_targets[1:]:
            require_vector_field(
                schema,
                target.vector_field,
                expected_dimension=self.embeddings.dimension,
            )
        schema_names = {field["name"] for field in schema["fields"]}
        missing_upload = [
            name for name in [config.id_field, *text_fields] if name not in upload.fields
        ]
        if missing_upload:
            raise HTTPException(
                status_code=422,
                detail={"message": f"Upload fields are missing: {', '.join(missing_upload)}."},
            )
        if config.id_field not in schema_names:
            raise HTTPException(status_code=422, detail={"message": "The selected ID field is not in the Solr schema."})

    def _enqueue_job(
        self,
        config: IngestJobCreateRequest,
        upload: UploadRecord,
        *,
        source_rows: tuple[int, ...] | None = None,
        retry_of: str | None = None,
    ) -> dict[str, Any]:
        job = IngestJob(
            id=uuid4().hex,
            config=config,
            filename=upload.filename,
            source_rows=source_rows,
            retry_of=retry_of,
            total=len(source_rows) if source_rows is not None else upload.total,
        )
        self.jobs[job.id] = job
        task = asyncio.create_task(self._run_job(job, upload), name=f"solr-ingest-{job.id}")
        self._tasks[job.id] = task
        task.add_done_callback(lambda _: self._tasks.pop(job.id, None))
        return job.as_dict()

    def list_jobs(self) -> list[dict[str, Any]]:
        return [job.as_dict() for job in sorted(self.jobs.values(), key=lambda item: item.created_at, reverse=True)]

    def get_job(self, job_id: str) -> IngestJob:
        job = self.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"message": "Ingest job was not found."})
        return job

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        if job.status in {"completed", "failed", "cancelled"}:
            return job.as_dict()
        job.cancel_requested = True
        return job.as_dict()

    async def cleanup_expired(self) -> None:
        cutoff = _now() - timedelta(hours=self.settings.upload_ttl_hours)
        active_upload_ids = {
            job.config.upload_id
            for job in self.jobs.values()
            if job.status in {"queued", "running"}
        }
        expired = [
            upload_id
            for upload_id, upload in self.uploads.items()
            if upload.created_at < cutoff and upload_id not in active_upload_ids
        ]
        for upload_id in expired:
            self.uploads.pop(upload_id).path.unlink(missing_ok=True)

    async def _run_job(self, job: IngestJob, upload: UploadRecord) -> None:
        async with self._worker:
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = _now()
                return
            job.status = "running"
            job.started_at = _now()
            indexed_records: list[tuple[int, dict[str, Any]]] = []
            try:
                records = await asyncio.to_thread(_parse_records, upload.path, upload.file_format)
                indexed_records = list(enumerate(records, start=1))
                if job.source_rows is not None:
                    selected_rows = set(job.source_rows)
                    indexed_records = [
                        item
                        for item in indexed_records
                        if item[0] in selected_rows
                    ]
                job.total = len(indexed_records)
                for start in range(0, len(indexed_records), job.config.batch_size):
                    if job.cancel_requested:
                        job.status = "cancelled"
                        break
                    await self._process_batch(
                        job,
                        indexed_records[start : start + job.config.batch_size],
                    )
                if job.status != "cancelled":
                    job.status = "failed" if job.succeeded == 0 and job.failed else "completed"
            except Exception as exc:  # noqa: BLE001 - keep the job inspectable
                job.status = "failed"
                message = _error_message(exc)
                remaining = indexed_records[job.processed :]
                if remaining:
                    for row, record in remaining:
                        document_id = str(record.get(job.config.id_field, "")).strip()
                        job.errors.append(IngestError(row=row, document_id=document_id, message=message))
                        job.failed_rows.add(row)
                    job.failed += len(remaining)
                    job.processed += len(remaining)
                else:
                    job.errors.append(IngestError(row=0, document_id="", message=message))
                    job.failed = max(job.failed, job.total - job.processed)
                    job.processed = job.total
            finally:
                job.finished_at = _now()

    async def _process_batch(
        self,
        job: IngestJob,
        records: list[tuple[int, dict[str, Any]]],
    ) -> None:
        valid: list[tuple[int, dict[str, Any], str, dict[str, str]]] = []
        for row, record in records:
            document_id = str(record.get(job.config.id_field, "")).strip()
            target_texts = {
                target.vector_field: "\n\n".join(
                    value
                    for field_name in target.text_fields
                    if (value := str(record.get(field_name, "")).strip())
                )
                for target in job.config.vector_targets
            }
            missing_target = next(
                (
                    target.vector_field
                    for target in job.config.vector_targets
                    if not target_texts[target.vector_field]
                ),
                None,
            )
            if not document_id or missing_target:
                missing = (
                    "ID"
                    if not document_id
                    else f"text for vector field '{missing_target}'"
                )
                job.errors.append(IngestError(row=row, document_id=document_id, message=f"Missing {missing}."))
                job.failed_rows.add(row)
                job.failed += 1
                job.processed += 1
                continue
            valid.append((row, record, document_id, target_texts))
        if not valid:
            return

        try:
            vectors_by_field: dict[str, list[list[float]]] = {}
            for target in job.config.vector_targets:
                vectors, _ = await self.embeddings.encode(
                    [
                        target_texts[target.vector_field]
                        for _, _, _, target_texts in valid
                    ]
                )
                vectors_by_field[target.vector_field] = vectors
            documents = []
            for index, (_, record, _, _) in enumerate(valid):
                documents.append(
                    {
                        **record,
                        **{
                            target.vector_field: vectors_by_field[target.vector_field][index]
                            for target in job.config.vector_targets
                        },
                    }
                )
            await self.solr.request(
                "POST",
                f"/{quote(job.config.collection, safe='')}/update",
                params={
                    "commitWithin": job.config.commit_within_ms,
                    "overwrite": "true",
                    "wt": "json",
                },
                json=documents,
            )
            job.succeeded += len(valid)
        except Exception as exc:  # noqa: BLE001 - report each rejected source row
            message = _error_message(exc)
            for row, _, document_id, _ in valid:
                job.errors.append(IngestError(row=row, document_id=document_id, message=message))
                job.failed_rows.add(row)
            job.failed += len(valid)
        finally:
            job.processed += len(valid)

    @staticmethod
    def _resolve_format(filename: str, requested: str | None) -> str:
        if requested and requested != "auto":
            file_format = requested.lower()
        else:
            suffix = Path(filename).suffix.lower()
            file_format = "jsonl" if suffix in {".jsonl", ".ndjson"} else suffix.lstrip(".")
        if file_format not in SUPPORTED_FORMATS:
            raise HTTPException(
                status_code=422,
                detail={"message": "Supported upload formats are JSON, JSONL, and CSV."},
            )
        return file_format

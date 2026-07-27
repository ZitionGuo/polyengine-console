import csv
import io

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..jobs import IngestManager
from ..models import IngestJobCreateRequest


router = APIRouter(prefix="/ingest", tags=["ingest"])


def get_ingest_manager(request: Request) -> IngestManager:
    return request.app.state.ingest_manager


@router.post("/uploads")
async def upload_documents(
    file: UploadFile = File(...),
    file_format: str = Form(default="auto"),
    manager: IngestManager = Depends(get_ingest_manager),
):
    return await manager.save_upload(file, file_format)


@router.post("/jobs", status_code=202)
async def create_job(
    payload: IngestJobCreateRequest,
    manager: IngestManager = Depends(get_ingest_manager),
):
    return await manager.create_job(payload)


@router.get("/jobs")
async def list_jobs(manager: IngestManager = Depends(get_ingest_manager)):
    return {"jobs": manager.list_jobs()}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, manager: IngestManager = Depends(get_ingest_manager)):
    return manager.get_job(job_id).as_dict()


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, manager: IngestManager = Depends(get_ingest_manager)):
    return manager.cancel_job(job_id)


@router.get("/jobs/{job_id}/errors")
async def download_errors(job_id: str, manager: IngestManager = Depends(get_ingest_manager)):
    job = manager.get_job(job_id)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["row", "document_id", "message"])
    for error in job.errors:
        writer.writerow([error.row, error.document_id, error.message])
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="ingest-{job_id}-errors.csv"'},
    )

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import tempfile
from datetime import datetime
import uuid
import logging
from typing import Optional
from dotenv import load_dotenv
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Thread pool for running blocking operations without freezing the event loop
# This allows multiple requests to be processed concurrently
executor = ThreadPoolExecutor(max_workers=4)

# Load environment variables from .env file
load_dotenv()

from services.pdf_service import extract_text_from_pdf, generate_improved_pdf
from services.ai_service import improve_resume_text
from services.templates import list_templates

# Configure logging with explicit stream handler to ensure console output
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()  # Force output to console
    ]
)
# Set level for all backend loggers
logging.getLogger("backend").setLevel(logging.INFO)
logger = logging.getLogger(__name__)

# Log environment configuration on startup
logger.info("=" * 80)
logger.info("BACKEND STARTUP - ENVIRONMENT CHECK")
logger.info("=" * 80)
api_key = os.getenv("GROQ_API_KEY", "")
model = os.getenv("LLM_MODEL", "")
if api_key:
    logger.info(f"✓ GROQ_API_KEY loaded: {api_key[:10]}...{api_key[-5:]}")
else:
    logger.error("✗ GROQ_API_KEY NOT FOUND!")
if model:
    logger.info(f"✓ LLM_MODEL: {model}")
else:
    logger.warning("⚠️ LLM_MODEL not set, will use default")
logger.info("=" * 80)

app = FastAPI(title="Resumax API")

# Per-IP request throttling. The heavy endpoints below run OCR/PDF generation
# and call out to Groq/Gemini, so an unthrottled client could both run up API
# cost and starve the (4-worker) thread pool for every other user.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # allow_credentials=True is invalid together with allow_origins=["*"]
    # (browsers reject that combination outright) and unnecessary here: the
    # app is a native Expo client that authenticates via request params, not
    # cookies, so no request ever needs credentials to cross an origin.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "backend/uploads"
OUTPUT_DIR = "backend/outputs"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Progress tracking
progress_store = {}

# ── Auto-cleanup: delete files older than 1 hour to prevent disk fill ──────────
def cleanup_old_files(directory: str, max_age_seconds: int = 3600):
    """Delete files older than max_age_seconds from directory."""
    import time
    now = time.time()
    deleted = 0
    try:
        for fname in os.listdir(directory):
            fpath = os.path.join(directory, fname)
            if os.path.isfile(fpath):
                age = now - os.path.getmtime(fpath)
                if age > max_age_seconds:
                    os.remove(fpath)
                    deleted += 1
        if deleted:
            logger.info(f"Auto-cleanup: removed {deleted} old file(s) from {directory}")
    except Exception as e:
        logger.warning(f"Auto-cleanup error in {directory}: {e}")

def cleanup_after_request(file_id: str):
    """
    Drop the bulky intermediates for a job, immediately after it completes.

    Deliberately KEEPS two things:

      {file_id}_debug.json  — the extracted CV. /api/generate-pdf reloads this
                              to render, so deleting it here made every download
                              fail with "Resume data not found. Please upload
                              again." It is also what makes switching to another
                              format without re-running the AI possible.
      {file_id}_photo.jpg   — same reason: needed to re-render.

    Both are still bounded by cleanup_old_files()'s one-hour sweep, so this does
    not reintroduce unbounded growth.
    """
    targets = [
        os.path.join(UPLOAD_DIR, f"{file_id}_original.pdf"),
        os.path.join(OUTPUT_DIR, f"{file_id}_ocr_result.txt"),
        os.path.join(OUTPUT_DIR, f"{file_id}_improvements.txt"),
    ]
    for path in targets:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            logger.warning(f"Could not delete temp file {path}: {e}")


# ── Upload guards ────────────────────────────────────────────────────────
# Both endpoints below used `await file.read()` with no limit at all: the
# whole body landed in memory as one bytes object regardless of size, so one
# large enough POST could OOM the instance before any validation ran. This
# reads in bounded chunks and aborts the moment the cap is crossed, instead
# of buffering an oversized upload just to reject it afterwards.
MAX_RESUME_BYTES = 10 * 1024 * 1024
PDF_MAGIC = b"%PDF-"


async def read_upload_capped(
    file: UploadFile, max_bytes: int, magic: Optional[bytes] = None
) -> bytes:
    """Read an UploadFile in chunks, enforcing max_bytes as it goes.

    magic, if given, must match the start of the content — checked as soon as
    the first chunk arrives, so a renamed non-PDF (or any other content-type
    mismatch) is rejected before the rest of the body is even read.
    """
    chunk_size = 1024 * 1024
    total = 0
    chunks = []
    first = True
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        if first:
            if magic and not chunk.startswith(magic):
                raise HTTPException(
                    status_code=400,
                    detail="File content doesn't match its extension.",
                )
            first = False
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File too large (max {max_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)


# ── Photo handling ────────────────────────────────────────────────────────
MAX_PHOTO_BYTES = 8 * 1024 * 1024
PHOTO_BOX = (450, 600)          # fixed 3:4 so renderers never do aspect math


def _blank_to_none(value):
    """Multipart form fields arrive as "" rather than absent when unset."""
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _language_pref(value):
    """"auto" (or unset) means the model decides; anything else is a hard override."""
    value = _blank_to_none(value)
    if value is None or value.lower() == "auto":
        return None
    return value.lower()


def photo_path_for(file_id: str):
    """Path of this job's photo, or None if it has none."""
    path = os.path.join(UPLOAD_DIR, f"{file_id}_photo.jpg")
    return path if os.path.exists(path) else None


def save_photo(file_id: str, raw: bytes) -> str:
    """
    Normalise an uploaded headshot to a predictable JPEG.

    Every step here is load-bearing:
      · verify()          rejects non-images before we decode anything
      · exif_transpose()  iOS stores portrait photos rotated with an EXIF flag
                          that PDF renderers ignore — without this, every
                          iPhone headshot comes out sideways
      · alpha flatten     transparent PNGs would otherwise render black
      · fit() to 3:4      the renderer can then use one constant image box,
                          biased slightly upward to favour the face
    """
    from PIL import Image, ImageOps, UnidentifiedImageError
    import io

    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Photo too large (max 8 MB)")

    try:
        Image.open(io.BytesIO(raw)).verify()
        img = Image.open(io.BytesIO(raw))
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="That file is not a readable image")

    img = ImageOps.exif_transpose(img)

    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[-1])
        img = flat
    else:
        img = img.convert("RGB")

    img = ImageOps.fit(img, PHOTO_BOX, Image.LANCZOS, centering=(0.5, 0.35))

    path = os.path.join(UPLOAD_DIR, f"{file_id}_photo.jpg")
    img.save(path, "JPEG", quality=88, optimize=True)
    logger.info(f"Photo saved for {file_id}: {path}")
    return path
# ──────────────────────────────────────────────────────────────────────────────

from fastapi.staticfiles import StaticFiles

# Get absolute path to the backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BACKEND_DIR, "static")

# Ensure static directory exists
os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def root():
    logger.info("Root endpoint called")
    return {"message": "Resumax API", "status": "running"}

@app.get("/api/templates")
async def get_templates():
    """Get list of available CV templates."""
    logger.info("Templates endpoint called")
    return {"templates": list_templates()}

@app.get("/api/progress/{file_id}")
async def get_progress(file_id: str):
    """Get processing progress for a file."""
    progress = progress_store.get(file_id, {
        "stage": "initializing",
        "message": "Starting...",
        "progress": 0
    })
    return progress

@app.post("/api/upload-resume")
@limiter.limit("10/minute")
async def upload_resume(
    request: Request,
    file: UploadFile = File(...),
    template_id: str = Form(default="professional"),
    # Saved user preferences, sent by the client on every upload. All optional:
    # an account that skipped onboarding sends nothing and gets the previous
    # behaviour exactly. "auto" for language means "let the model decide".
    language: str = Form(default=None),
    target_role: str = Form(default=None),
    experience_level: str = Form(default=None),
    # Optional headshot, for formats where a photo is conventional. Accepted
    # here as well as on /api/upload-photo because file_id does not exist until
    # this call returns, and /api/generate-pdf is Pro-gated — a free user
    # choosing Europass must still see their photo in this first render.
    photo: UploadFile = File(None),
):
    logger.info(f"Upload resume request received. Filename: {file.filename}, Template: {template_id}")
    
    # Prune files older than 1 hour from both directories before accepting new upload
    cleanup_old_files(UPLOAD_DIR)
    cleanup_old_files(OUTPUT_DIR)

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        logger.warning(f"Invalid file format: {file.filename}")
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")
    
    file_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()
    
    # Initialize progress
    progress_store[file_id] = {
        "stage": "uploading",
        "message": "Uploading your resume...",
        "progress": 10
    }
    
    original_path = os.path.join(UPLOAD_DIR, f"{file_id}_original.pdf")
    logger.info(f"Processing file {file_id}. Saving to {original_path}")
    
    try:
        contents = await read_upload_capped(file, MAX_RESUME_BYTES, magic=PDF_MAGIC)
        with open(original_path, "wb") as f:
            f.write(contents)
        logger.info(f"File saved successfully. Size: {len(contents)} bytes")

        # A bad photo must never sink an otherwise good resume upload.
        if photo is not None and photo.filename:
            try:
                save_photo(file_id, await read_upload_capped(photo, MAX_PHOTO_BYTES))
            except HTTPException as e:
                logger.warning(f"Photo rejected for {file_id}: {e.detail}")
            except Exception as e:
                logger.warning(f"Photo processing failed for {file_id}: {e}")
        
        progress_store[file_id] = {
            "stage": "uploaded",
            "message": "Upload complete! Extracting text...",
            "progress": 25
        }
        
        logger.info("=" * 80)
        logger.info("STEP 1: TEXT EXTRACTION")
        logger.info("=" * 80)
        
        progress_store[file_id] = {
            "stage": "extracting",
            "message": "Reading your resume with OCR...",
            "progress": 40
        }
        
        # Run blocking PDF extraction in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        original_text = await loop.run_in_executor(
            executor, extract_text_from_pdf, original_path
        )
        logger.info(f"✓ Text extraction complete")
        logger.info(f"   Extracted length: {len(original_text)} characters")
        logger.info(f"   Preview (first 200 chars): {original_text[:200]}")
        
        if not original_text.strip():
            logger.error("✗ Extracted text is empty!")
            progress_store[file_id] = {
                "stage": "error",
                "message": "Could not extract text from PDF",
                "progress": 0
            }
            raise HTTPException(status_code=400, detail="Could not extract text from PDF")
        
        logger.info("=" * 80)
        logger.info("STEP 2: AI IMPROVEMENT (JSON MODE)")
        logger.info(f"   Template: {template_id}")
        logger.info("=" * 80)
        
        progress_store[file_id] = {
            "stage": "improving",
            "message": "AI is enhancing your resume...",
            "progress": 60
        }
        
        # improved_data is now a dict (JSON)
        improved_data = await improve_resume_text(
            original_text, file_id, template_id,
            target_role=_blank_to_none(target_role),
            experience_level=_blank_to_none(experience_level),
            language=_language_pref(language),
        )
        
        logger.info("=" * 80)
        logger.info("✓ AI improvement complete")
        logger.info(f"   Data keys: {list(improved_data.keys())}")
        
        # Save debug output (Persist data for later generation)
        debug_path = os.path.join(OUTPUT_DIR, f"{file_id}_debug.json")
        import json
        with open(debug_path, "w", encoding="utf-8") as f:
            json.dump(improved_data, f, indent=2)
        logger.info(f"Debug JSON saved to: {debug_path}")
        logger.info("=" * 80)
        
        progress_store[file_id] = {
            "stage": "formatting",
            "message": "Formatting your professional resume...",
            "progress": 80
        }
        
        logger.info("=" * 80)
        logger.info("STEP 3: PDF GENERATION")
        logger.info("=" * 80)
        
        # Generate the PDF immediately
        improved_path = os.path.join(OUTPUT_DIR, f"{file_id}_improved.pdf")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            executor, generate_improved_pdf, improved_data, improved_path,
            template_id, photo_path_for(file_id),
        )

        logger.info(f"✓ PDF generated successfully: {improved_path}")
        logger.info("=" * 80)

        # Delete temp files for this job — only keep the final PDF
        cleanup_after_request(file_id)

        progress_store[file_id] = {
            "stage": "complete",
            "message": "Your resume is ready!",
            "progress": 100
        }
        
        return {
            "id": file_id,
            "original_filename": file.filename,
            "timestamp": timestamp,
            "original_text": original_text,
            "improved_data": improved_data,
            "download_url": f"/api/download/{file_id}",
            "template_id": template_id,
            "has_photo": photo_path_for(file_id) is not None,
            # The language the headings were rendered in. Returned so the app
            # can tell the user when their CV is in a language we have no
            # heading table for and English was used instead.
            "language": improved_data.get("language"),
        }
    
    except HTTPException:
        # Let cap/format rejections (413/400) reach the client as-is instead of
        # being flattened into a generic 500 by the except below.
        raise
    except Exception as e:
        logger.error(f"Error processing resume: {str(e)}", exc_info=True)
        progress_store[file_id] = {
            "stage": "error",
            "message": f"Error: {str(e)}",
            "progress": 0
        }
        if os.path.exists(original_path):
            os.remove(original_path)
        raise HTTPException(status_code=500, detail=f"Error processing resume: {str(e)}")

@app.get("/api/download/{file_id}")
async def download_resume(file_id: str):
    logger.info(f"Download request for file_id: {file_id}")
    file_path = os.path.join(OUTPUT_DIR, f"{file_id}_improved.pdf")
    
    if not os.path.exists(file_path):
        logger.warning(f"File not found: {file_path}")
        raise HTTPException(status_code=404, detail="File not found")
    
    logger.info(f"Serving file: {file_path}")
    
    # Schedule deletion after serving — keep disk clean
    async def delete_after_response():
        import asyncio
        await asyncio.sleep(30)  # 30s grace period in case of retries
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Auto-deleted served PDF: {file_path}")
        except Exception as e:
            logger.warning(f"Could not auto-delete {file_path}: {e}")

    asyncio.create_task(delete_after_response())

    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename="CV.pdf"
    )

from pydantic import BaseModel
from services.revenue_cat_service import revenue_cat_service

class GeneratePDFRequest(BaseModel):
    file_id: str
    user_id: str
    template_id: str = "professional"

@app.get("/health")
async def health_check():
    logger.info("Health check called")
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.post("/api/generate-pdf")
@limiter.limit("20/minute")
async def generate_pdf(request: Request, body: GeneratePDFRequest):
    """
    Generate PDF for a file. Requires Pro Access verification.
    """
    logger.info(f"Generate PDF request for file: {body.file_id}, User: {body.user_id}")
    
    # 1. Verify Entitlement
    if not revenue_cat_service.verify_pro_access(body.user_id):
        logger.warning(f"Access denied for user {body.user_id}")
        raise HTTPException(status_code=403, detail="Pro access required to generate PDF")
        
    # 2. Load Data
    debug_path = os.path.join(OUTPUT_DIR, f"{body.file_id}_debug.json")
    if not os.path.exists(debug_path):
        raise HTTPException(status_code=404, detail="Resume data not found. Please upload again.")
        
    import json
    with open(debug_path, "r", encoding="utf-8") as f:
        improved_data = json.load(f)
        
    # 3. Generate PDF. The photo is stored per file_id, independent of format —
    #    the renderer decides whether to use it, so switching Europass -> US ->
    #    Europass simply hides and re-shows it with no state to manage.
    improved_path = os.path.join(OUTPUT_DIR, f"{body.file_id}_improved.pdf")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        executor, generate_improved_pdf, improved_data, improved_path,
        body.template_id, photo_path_for(body.file_id),
    )

    return {
        "status": "success",
        "download_url": f"/api/download/{body.file_id}"
    }


@app.post("/api/upload-photo")
@limiter.limit("20/minute")
async def upload_photo(request: Request, file_id: str = Form(...), photo: UploadFile = File(...)):
    """Attach or replace the headshot for an existing job."""
    if not os.path.exists(os.path.join(OUTPUT_DIR, f"{file_id}_debug.json")):
        raise HTTPException(status_code=404, detail="Resume data not found. Please upload again.")
    save_photo(file_id, await read_upload_capped(photo, MAX_PHOTO_BYTES))
    return {"status": "success", "has_photo": True}


@app.delete("/api/photo/{file_id}")
async def delete_photo(file_id: str):
    """Remove the headshot. Idempotent."""
    path = os.path.join(UPLOAD_DIR, f"{file_id}_photo.jpg")
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception as e:
            logger.warning(f"Could not delete photo {path}: {e}")
    return {"status": "success", "has_photo": False}

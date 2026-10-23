"""Local prescription OCR and rule-based recovery attention scoring."""
from __future__ import annotations

import asyncio
import csv
from datetime import date, datetime, timedelta, timezone
import hmac
import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
import warnings
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
MODEL_VERSION = "attention-rules-v1"
OCR_ENGINE = os.environ.get("OCR_ENGINE", "tesseract").lower()
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/tiff", "image/bmp"}
log = logging.getLogger("recovertrack.intelligence")
app = FastAPI(title="RecoverTrack Intelligence", version="1.0.0", docs_url=None, redoc_url=None)
_ocr_semaphore = asyncio.Semaphore(2)
_trocr_components = None


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    if expected and not hmac.compare_digest(x_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="Internal authentication required")


class DoseInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    scheduledAt: datetime
    status: Literal["upcoming", "due", "taken", "missed", "skipped"]

    @field_validator("scheduledAt")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("scheduledAt must include a timezone")
        return value


class CheckInInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    date: date
    pain: int = Field(ge=0, le=10)
    mobility: Literal["resting", "assisted", "independent"]


class RiskInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    doses: list[DoseInput] = Field(default_factory=list, max_length=5000)
    checkIns: list[CheckInInput] = Field(default_factory=list, max_length=365)
    timeZone: str = Field(default="Asia/Kolkata", max_length=100)

    @field_validator("timeZone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Unknown IANA timezone") from None
        return value


def calculate_risk(payload: RiskInput, now: datetime | None = None) -> dict:
    """Score seven days of elapsed dose records and daily symptom reports.

    Require three eligible doses or two daily check-ins. Doses still within their
    grace period are excluded. These rules are not clinically validated.
    """
    now = now or datetime.now(timezone.utc)
    window_start = now - timedelta(days=7)
    today = now.astimezone(ZoneInfo(payload.timeZone)).date()
    doses = sorted(
        (d for d in payload.doses if window_start <= d.scheduledAt <= now
         and d.status in {"taken", "missed", "skipped"}),
        key=lambda d: d.scheduledAt,
    )
    # Keep the last report for each local day.
    daily = {c.date: c for c in payload.checkIns if today - timedelta(days=6) <= c.date <= today}
    checkins = sorted(daily.values(), key=lambda c: c.date)
    missed = sum(d.status in {"missed", "skipped"} for d in doses)
    rate = missed / len(doses) if doses else 0.0
    streak = 0
    for dose in reversed(doses):
        if dose.status in {"missed", "skipped"}:
            streak += 1
        else:
            break
    features = {
        "observedDoses": len(doses), "missedDoses": missed,
        "missedRate": round(rate, 4), "currentMissedStreak": streak,
        "recentCheckIns": len(checkins),
    }
    base = {"experimental": True, "modelVersion": MODEL_VERSION, "features": features}
    if len(doses) < 3 and len(checkins) < 2:
        return {**base, "score": None, "level": "unavailable", "explanation": [
            "Not enough recent records yet. At least 3 elapsed dose records or 2 daily check-ins are needed.",
            "This experimental attention indicator is not a diagnosis or a prediction of complications.",
        ]}

    score = rate * 50 + min(streak, 3) * 5
    reasons = []
    if missed:
        reasons.append(f"{missed} of {len(doses)} elapsed doses have no taken check-in in the last 7 days ({round(rate * 100)}%).")
    elif doses:
        reasons.append(f"All {len(doses)} recorded elapsed doses were checked in as taken in the last 7 days.")
    if streak >= 2:
        reasons.append(f"The latest {streak} elapsed doses are missed or skipped.")

    mobility_order = {"resting": 0, "assisted": 1, "independent": 2}
    if checkins:
        current = checkins[-1]
        features["latestPain"] = current.pain
        features["latestMobility"] = mobility_order[current.mobility]
        score += 25 if current.pain >= 7 else 10 if current.pain >= 4 else 0
        reasons.append(f"The latest self-reported pain score is {current.pain}/10.")
        score += {"resting": 10, "assisted": 5, "independent": 0}[current.mobility]
        if len(checkins) >= 2:
            previous = checkins[-2]
            change = current.pain - previous.pain
            features["painChange"] = change
            if change >= 2:
                score += 15
                reasons.append(f"Reported pain rose by {change} points since the previous daily check-in.")
            elif change <= -2:
                reasons.append(f"Reported pain decreased by {abs(change)} points since the previous daily check-in.")
            if mobility_order[current.mobility] < mobility_order[previous.mobility]:
                score += 10
                reasons.append(f"Reported mobility changed from {previous.mobility} to {current.mobility}.")
        if current.mobility == "resting":
            reasons.append("The latest check-in reports mostly resting. Expected mobility depends on the prescribed recovery plan.")
        elif current.mobility == "assisted":
            reasons.append("The latest check-in reports moving with assistance.")
        else:
            reasons.append("The latest check-in reports moving independently.")
        if current.date < today - timedelta(days=1):
            reasons.append("The latest daily check-in is more than one day old; current symptoms are unknown.")
    else:
        reasons.append("No daily pain or mobility check-ins are available for the last 7 days.")

    rounded = max(0, min(100, round(score)))
    band = "high" if rounded >= 55 else "moderate" if rounded >= 25 else "low"
    reasons.append("Experimental rule-based attention indicator; not a diagnosis, probability, or medication instruction.")
    return {**base, "score": rounded, "level": band, "explanation": reasons}


# Missing fields stay empty for the reviewer to complete.
_STRENGTH_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mcg|μg|ug|mg|g|ml|mL|iu|IU|units?)(?:\s*/\s*\d*\s*(?:ml|mL))?\b", re.I)
_DOSE_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:tablets?|tabs?|capsules?|caps?|puffs?|drops?|sachets?|spoonfuls?|tsp)\b", re.I)
_DURATION_RE = re.compile(r"\b(?:for\s+|x\s*)?(\d{1,3})\s*(days?|weeks?)\b", re.I)
_FREQUENCY_RE = re.compile(r"\b(?:once\s+daily|twice\s+daily|three\s+times\s+(?:daily|a\s+day)|four\s+times\s+(?:daily|a\s+day)|morning|afternoon|evening|at\s+night|night|daily|OD|BD|BID|TID|TDS|QID|every\s+\d+\s+hours?)\b", re.I)
_NAME_PREFIX = re.compile(r"^\s*(?:(?:\d+[.)]|[-•*])\s*)?(?:(?:tab(?:let)?|cap(?:sule)?|syrup|inj(?:ection)?)\.?\s+)?", re.I)
_NO_NAME = re.compile(r"^(?:patient|doctor|dr|date|address|hospital|clinic|age|name|prescription|rx|take|use|apply|continue|instructions|frequency|duration|morning|afternoon|evening|night|for|after|before|once|twice|three|every)\b", re.I)


def parse_prescription(text: str) -> list[dict]:
    """Extract medication candidates from lines and pipe-separated fields."""
    candidates = []
    lines = [re.sub(r"\s+", " ", x).strip() for x in text.splitlines() if x.strip()]
    # Join wrapped instructions without merging separate medications.
    groups = []
    for line in lines:
        starts_medicine = bool(_STRENGTH_RE.search(line) and not _NO_NAME.match(_NAME_PREFIX.sub("", line)))
        starts_named = bool(re.match(r"^(?:MED[- ]?[A-Z]\b|(?:tab(?:let)?|cap(?:sule)?|syrup)\.?\s+\S)", line, re.I))
        continuation = bool(_DOSE_RE.search(line) or _DURATION_RE.search(line) or _FREQUENCY_RE.search(line) or re.match(r"^(?:after|before|with)\s+(?:food|meals?)", line, re.I))
        if groups and continuation and not starts_medicine and not starts_named:
            groups[-1] += " | " + line
        else:
            groups.append(line)
    for line in groups:
        if len(candidates) >= 30:
            break
        strength = _STRENGTH_RE.search(line)
        if not strength:
            continue
        prefix = line[:strength.start()].strip(" |,;:-")
        name = _NAME_PREFIX.sub("", prefix).strip(" |,;:-")
        if not name or len(name) > 120 or _NO_NAME.match(name) or not re.search(r"[A-Za-z]", name):
            continue
        dose = _DOSE_RE.search(line)
        duration = _DURATION_RE.search(line)
        frequency = _FREQUENCY_RE.search(line)
        days = None
        if duration:
            days = int(duration.group(1)) * (7 if duration.group(2).lower().startswith("week") else 1)
            if not 1 <= days <= 180:
                days = None
        # Frequency labels such as "morning" do not specify an exact dose time.
        times = sorted(set(re.findall(r"\b(?:[01]\d|2[0-3]):[0-5]\d\b", line)))
        instructions = ""
        inst = re.search(r"\b(?:after|before|with|without)\s+(?:food|meals?|breakfast|lunch|dinner|water)\b[^|;]*", line, re.I)
        if inst:
            instructions = inst.group(0).strip()
        candidates.append({
            "name": name, "strength": strength.group(0).strip(),
            "dose": dose.group(0).strip() if dose else "",
            "frequency": frequency.group(0).strip() if frequency else "",
            "instructions": instructions, "times": times, "durationDays": days,
            "reviewRequired": True,
        })
    return candidates


def decode_image(data: bytes) -> Image.Image:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data))
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image exceeds 20 megapixels; resize it before uploading")
            if getattr(image, "n_frames", 1) > 1:
                raise HTTPException(status_code=415, detail="Upload a single-page image, not an animated or multipage file")
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")
            return image
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(status_code=413, detail="Image is too large; resize it before uploading") from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=415, detail="The file is not a valid supported image") from None


def tesseract_ocr(image: Image.Image) -> tuple[str, float | None]:
    executable = shutil.which("tesseract")
    if not executable:
        raise HTTPException(status_code=503, detail="Tesseract is unavailable; use manual medication entry")
    # TemporaryDirectory removes the image after OCR, including on failure.
    with tempfile.TemporaryDirectory(prefix="recovertrack-ocr-") as directory:
        source = Path(directory) / "input.png"
        image.save(source)
        try:
            process = subprocess.run([executable, str(source), "stdout", "-l", "eng", "--psm", "6", "tsv"],
                                     capture_output=True, text=True, timeout=45, check=False)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="OCR timed out; try a smaller, clearer photo or enter details manually") from None
        if process.returncode:
            log.warning("Local OCR engine failed with code %s", process.returncode)
            raise HTTPException(status_code=502, detail="OCR could not read this image; try a clearer image or manual entry")
        rows = list(csv.DictReader(io.StringIO(process.stdout), delimiter="\t"))
        grouped: dict[tuple, list[str]] = {}
        confidences = []
        for row in rows:
            word = (row.get("text") or "").strip()
            if not word:
                continue
            key = (row.get("page_num"), row.get("block_num"), row.get("par_num"), row.get("line_num"))
            grouped.setdefault(key, []).append(word)
            try:
                confidence = float(row.get("conf", "-1"))
                if confidence >= 0:
                    confidences.append(confidence)
            except (TypeError, ValueError):
                pass
        text = "\n".join(" ".join(words) for words in grouped.values())[:50000]
        confidence = round(sum(confidences) / len(confidences) / 100, 3) if confidences else None
        return text, confidence


def trocr_ocr(image: Image.Image) -> tuple[str, None]:
    global _trocr_components
    model_path = os.environ.get("TROCR_MODEL_PATH")
    if not model_path or not Path(model_path).is_dir():
        raise HTTPException(status_code=503, detail="TrOCR requires a verified local TROCR_MODEL_PATH; use Tesseract or manual entry")
    try:
        if _trocr_components is None:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
            processor = TrOCRProcessor.from_pretrained(model_path, local_files_only=True)
            model = VisionEncoderDecoderModel.from_pretrained(model_path, local_files_only=True)
            model.eval()
            _trocr_components = processor, model
        import torch
        processor, model = _trocr_components
        # This adapter accepts a single text line per image.
        pixels = processor(images=image, return_tensors="pt").pixel_values
        with torch.inference_mode():
            tokens = model.generate(pixels, max_new_tokens=256)
        return processor.batch_decode(tokens, skip_special_tokens=True)[0][:50000], None
    except HTTPException:
        raise
    except (ImportError, OSError, RuntimeError, ValueError):
        log.warning("TrOCR unavailable or local model invalid")
        raise HTTPException(status_code=503, detail="TrOCR could not load the local model; use Tesseract or manual entry") from None


@app.get("/health")
def health() -> dict:
    available = bool(shutil.which("tesseract")) if OCR_ENGINE == "tesseract" else bool(os.environ.get("TROCR_MODEL_PATH"))
    return {"status": "ok", "ocr": OCR_ENGINE, "ocrAvailable": available,
            "risk": MODEL_VERSION, "experimental": True}


@app.post("/risk", dependencies=[Depends(require_internal_token)])
def risk(payload: RiskInput) -> dict:
    return calculate_risk(payload)


@app.post("/ocr", dependencies=[Depends(require_internal_token)])
async def ocr(file: UploadFile = File(...)) -> dict:
    if file.content_type not in ALLOWED_MIME:
        await file.close()
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, WebP, TIFF, or BMP image")
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller")
    image = await asyncio.to_thread(decode_image, data)
    try:
        async with _ocr_semaphore:
            if OCR_ENGINE == "tesseract":
                text, confidence = await asyncio.to_thread(tesseract_ocr, image)
            elif OCR_ENGINE == "trocr":
                text, confidence = await asyncio.to_thread(trocr_ocr, image)
            else:
                raise HTTPException(status_code=503, detail="Unsupported OCR engine; configure tesseract or trocr")
    finally:
        image.close()
    warning = "Draft only. Review every medication, strength, dose, exact time, and duration against the original prescription before confirming. OCR confidence is not clinical accuracy."
    if OCR_ENGINE == "trocr":
        warning += " This optional TrOCR adapter supports single text lines; whole-prescription handwriting accuracy has not been validated."
    if not text.strip():
        warning = "No readable text was found. Retake a clearer photo or enter the medication details manually."
    return {"text": text, "engine": OCR_ENGINE, "confidenceScore": confidence,
            "confidenceMeaning": "Mean OCR word confidence; not medication-field accuracy" if confidence is not None else None,
            "criticalityFlag": True, "warning": warning, "medications": parse_prescription(text)}

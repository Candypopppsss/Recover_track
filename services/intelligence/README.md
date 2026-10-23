# Intelligence service

The main supervisor starts this service. To run it separately from the repository root:

```sh
.venv/bin/python -m uvicorn services.intelligence.app:app --host 127.0.0.1 --port 8001
.venv/bin/python -m unittest discover -s services/intelligence -p 'test_*.py' -v
```

Requires the packages in `requirements.txt` (`requirements-dev.txt` for tests), Tesseract and English language data. Keep the service on loopback or a private network. API and Python must share `INTERNAL_SERVICE_TOKEN`; protected endpoints accept `X-Internal-Token`. `GET /health` reports availability.

## OCR

`POST /ocr` accepts a multipart `file`. Limits: 10 MB, 20 megapixels, one frame, two concurrent requests and 45 seconds per Tesseract operation. Temporary images are removed after extraction.

The parser returns text, mean word confidence and candidate medication fields. Only explicit clock times are proposed; missing fields remain blank. Confidence is not field accuracy. The parser has no drug lexicon and does not infer surgery type. The API requires caregiver review before scheduling.

Optional `OCR_ENGINE=trocr` loads a verified local `TROCR_MODEL_PATH` with separately installed `torch` and `transformers`. This adapter reads a single line; whole-page handwriting segmentation is not implemented. No model is downloaded at runtime.

## Attention rules

`POST /risk` accepts dose timestamps/statuses and daily pain/mobility reports. It excludes identities, notes and medication names. The last seven days are considered; future and still-in-grace-window doses are excluded. A score requires three elapsed dose records or two distinct daily check-ins. Otherwise `score` is null.

| Input | Points |
| --- | ---: |
| Missed/skipped fraction | Fraction × 50 |
| Current missed/skipped streak | 5 per dose, up to 15 |
| Latest pain ≥7 / ≥4 | 25 / 10 |
| Pain increase ≥2 since prior check-in | 15 |
| Resting / assisted mobility | 10 / 5 |
| Mobility worse than prior check-in | 10 |

The sum is clamped to 0–100. Bands: low <25, moderate 25–54, high ≥55. Responses include the observed reasons. These prototype weights are not clinically validated; the score is not a diagnosis or a medication instruction.

# RecoverTrack

Post-surgery medication schedules, dose records and daily pain/mobility check-ins for patients and caregivers. Clinicians can review a shared household record and manage follow-ups.

## Development

Requires Node.js 24+, Python 3.12 with `venv`, and Tesseract with English language data (`tesseract-ocr` and `tesseract-ocr-eng` on Debian/Ubuntu).

```bash
bash scripts/setup.sh
npm run dev
```

The supervisor starts Vite on port 5173, Express on 3001 and FastAPI on 8001. Ctrl+C stops all three. For a production build, run `npm run build` followed by `npm start`.

Create an account for an empty household, or choose a demo role to use fictional records. Each demo session is separate. Share a household through a private invitation code; invitations do not send email.

## Features

- Prescription image OCR, field correction and required review before scheduling.
- Medication courses with explicit dates, times and patient timezone.
- Dose check-ins, corrections, missed-dose alerts and CSV export.
- Daily pain/mobility reports, adherence charts and an experimental attention score.
- Caregiver invitations, clinician review, follow-up queue and access history.

SQLite is the default. Record payloads use AES-256-GCM encryption; retain `.data/encryption.key` with the database. `MONGODB_URI` selects the optional MongoDB adapter, which has not been integration-tested.

## Tests

```bash
npm test
.venv/bin/python -m unittest discover -s services/intelligence -p 'test_*.py'
npm run test:e2e
npm run build
npm run check:secrets
```

Playwright uses system Chromium when available. Otherwise install it with `npx playwright install chromium`.

`check:secrets` inspects tracked/staged files and build assets. Environment files (including examples), private keys, runtime databases and deployment credentials are excluded from publication.

## Deployment

Use Docker for the complete app. See [deployment instructions](docs/DEPLOYMENT.md) for persistent storage, HTTPS and secret configuration. Vercel can host the frontend when an existing HTTPS backend is available.

## Limits

OCR output requires human review. The attention score uses unvalidated rules, not a trained clinical model. Dose records are self-reports. Notifications require running services and an open app; external messaging and hospital-wide integration are not implemented. Review [deployment requirements](docs/DEPLOYMENT.md) before using real patient data.

[Architecture](docs/IMPLEMENTATION.md) · [API](docs/API_CONTRACT.md) · [Testing and OCR study](docs/VALIDATION.md)

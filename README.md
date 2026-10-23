# RecoverTrack

Post-surgery medication schedules, dose records and daily pain/mobility check-ins for patients and caregivers. Clinicians can review a shared household record and manage follow-ups.

## Deploy on Vercel

Import this repository into Vercel and deploy from the repository root. The checked-in `vercel.json` serves the React app and `/api` functions together; a separate backend or Python host is not required.

Set these private environment variables in the Vercel project before deployment:

- `MONGODB_URI`: your MongoDB connection string, with a database user and network access for Vercel.
- `DATA_ENCRYPTION_KEY`: a persistent base64-encoded 32-byte key. Keep the same key across redeployments.

The API requires MongoDB and refuses temporary local storage. Sessions and encrypted record payloads are stored in MongoDB. The Vercel entrypoint enables secure cookies and proxy handling; OCR runs in Node with bundled English language data.

Vercel Hobby and MongoDB Atlas Free can support a personal demo within their quotas. Neither provides an uninterrupted-service or always-free guarantee. The configuration is included, but no public deployment or live database connection has been verified. See [deployment instructions](docs/DEPLOYMENT.md) for setup and limits.

## Local development

Requires Node.js 24+, Python 3.12 with `venv`, and Tesseract with English language data (`tesseract-ocr` and `tesseract-ocr-eng` on Debian/Ubuntu).

```bash
bash scripts/setup.sh
npm run dev
```

The supervisor starts Vite on port 5173, Express on 3001 and FastAPI on 8001. Ctrl+C stops all three. For a local production build, run `npm run build` followed by `npm start`.

Create an account for an empty household, or choose a demo role to use fictional records. Each demo session is separate. Household invitations use private codes, not email.

## Features

- Prescription image OCR, field correction and required review before scheduling.
- Medication courses with explicit dates, times and patient timezone.
- Dose check-ins, corrections, missed-dose alerts and CSV export.
- Daily pain/mobility reports, adherence charts and an experimental attention score.
- Caregiver invitations, clinician review, follow-up queue and access history.

Local development uses SQLite unless `MONGODB_URI` is set. Retain `.data/encryption.key` with the local database. Hosted records use MongoDB and the private `DATA_ENCRYPTION_KEY`; neither the database nor its key belongs in the repository.

## Tests

```bash
npm test
.venv/bin/python -m unittest discover -s services/intelligence -p 'test_*.py'
npm run test:e2e
npm run build
npm run check:secrets
```

Playwright uses system Chromium when available. Otherwise install it with `npx playwright install chromium`. The secrets check inspects staged/tracked files and build assets without printing secret values.

## Limits

OCR output requires human review. The attention score uses unvalidated rules, not a trained clinical model. Dose records are self-reports. Vercel reminders are evaluated when the open app makes requests; there is no background worker or closed-app delivery. External messaging and hospital-wide integration are not implemented. Review [deployment requirements](docs/DEPLOYMENT.md#before-real-patient-use) before using real patient data.

[Architecture](docs/IMPLEMENTATION.md) · [API](docs/API_CONTRACT.md) · [Testing and OCR study](docs/VALIDATION.md)

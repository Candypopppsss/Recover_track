# RecoverTrack

Post-surgery medication schedules, dose records and daily pain/mobility check-ins for patients and caregivers. Clinicians can review a shared household record and manage follow-ups.

## Website and workspace

The public homepage at `/` explains the project and can be read without signing in or connecting to the API. **Sign in** opens `/signin`; account creation and fictional demo sessions have separate `/register` and `/demo` pages. The authenticated workspace opens at `/dashboard`. A protected link returns to its requested workspace page after sign-in. Older `/#access` links open the homepage from the top.

## Deploy on Vercel

Import this repository into Vercel and deploy from the repository root. The checked-in `vercel.json` serves the React app and `/api` functions together; a separate backend or Python host is not required.

Use **Neon PostgreSQL** through the Vercel project integration:

1. In the Vercel project, open **Storage → Create Database → Neon**.
2. Choose **Neon Free**, connect it to the project and enable the **Production** environment. The integration supplies `DATABASE_URL`; `POSTGRES_URL` is also supported.
3. Add a persistent, private `DATA_ENCRYPTION_KEY`: a base64-encoded 32-byte key. Keep an existing valid key unchanged.
4. Redeploy, then check `/api/health`, login and saved records through the deployed app.

Tables and indexes are created automatically on first connection. No manual SQL or MongoDB IP allowlist is needed for this flow. The API requires a hosted database and refuses temporary local storage. Vercel enables secure cookies; OCR and scoring run in Node without a separate Python host.

Vercel Hobby and Neon Free can support a personal demo within their quotas. Choose Free explicitly; the repository does not create a paid plan or trial. Current account eligibility and a live Neon connection have not been verified. See [deployment instructions](docs/DEPLOYMENT.md) for setup, troubleshooting and limits.

## Local development

Requires Node.js 24+, Python 3.12 with `venv`, and Tesseract with English language data (`tesseract-ocr` and `tesseract-ocr-eng` on Debian/Ubuntu).

```bash
bash scripts/setup.sh
npm run dev
```

The supervisor starts Vite on port 5173, Express on 3001 and FastAPI on 8001. Ctrl+C stops all three. For a local production build, run `npm run build` followed by `npm start`.

Open `/register` for an empty household, or `/demo` to choose a role and use fictional records. Each demo session is separate. Household invitations use private codes, not email. Existing accounts sign in at `/signin`.

## Features

- Prescription image OCR, field correction and required review before scheduling.
- Medication courses with explicit dates, times and patient timezone.
- Dose check-ins, corrections, missed-dose alerts and CSV export.
- Daily pain/mobility reports, adherence charts and an experimental attention score.
- Caregiver invitations, clinician review, follow-up queue and access history.

Storage selection is `DATABASE_URL`, then `POSTGRES_URL`, then `MONGODB_URI`, otherwise local SQLite. Vercel requires PostgreSQL or MongoDB. Retain `.data/encryption.key` with a local SQLite database and keep hosted encryption keys private. Changing the database connection does not migrate or delete existing records.

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

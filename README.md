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

SQLite is the local default. Record payloads use AES-256-GCM encryption; retain `.data/encryption.key` with the database. `MONGODB_URI` selects MongoDB, used by the free hosted profile and integration-tested against MongoDB 8. Keep its encryption key in the host's private environment.

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

For a free hosted demo, use [Render Free with MongoDB Atlas Free](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FCandypopppsss%2FRecover_track). The Blueprint configures the complete app and HTTPS, with records stored in your free Atlas database. It requests no paid service or disk. Both providers require accounts, and Atlas setup is required before deployment.

Render can require credit-card identity verification even for a Free service. This template cannot remove that requirement and does not guarantee card-free signup.

Render Free sleeps after 15 minutes without incoming traffic; reopening can take about a minute. Background reminders pause while it sleeps. Free-tier storage and monthly usage limits apply.

See [deployment instructions](docs/DEPLOYMENT.md) for Render setup or an existing Docker server. Vercel can host the frontend when an existing HTTPS backend is available.

## Limits

OCR output requires human review. The attention score uses unvalidated rules, not a trained clinical model. Dose records are self-reports. Notifications require running services and an open app; external messaging and hospital-wide integration are not implemented. Review [deployment requirements](docs/DEPLOYMENT.md) before using real patient data.

[Architecture](docs/IMPLEMENTATION.md) · [API](docs/API_CONTRACT.md) · [Testing and OCR study](docs/VALIDATION.md)

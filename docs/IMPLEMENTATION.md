# Architecture

## Vercel runtime

```mermaid
flowchart LR
  Web[React / Vite] --> API[Express on Vercel Functions]
  API --> DB[PostgreSQL encrypted records]
  API --> OCR[Node / Tesseract.js WASM]
  API --> Rules[Attention rules]
```

The default Vercel deployment serves the frontend and API from one origin. `api/index.mjs` delegates startup to `server/vercel.mjs`, which validates the private database/key settings and initializes the API with a hosted database, database-backed mutation coordination and in-process OCR/scoring. It requires a stable private encryption key; a function's temporary filesystem is not used for persistent records. Function duration is capped at 60 seconds and uploads at 4 MB.

The Node OCR adapter bundles English trained data and runs Tesseract.js/WASM. It does not invoke native Python or send images to an OCR provider. Attention scoring uses the same explicit rules as the local Python service. Reminders are evaluated on requests instead of relying on a serverless background interval.

## Components

The public website at `/` renders independently of API/session initialization. It contains no authentication form. `/signin`, `/register` and `/demo` are dedicated access pages; the recovery dashboard is `/dashboard`, with the existing protected schedule, medication and care-team routes. Protected deep links preserve a validated internal destination through sign-in. Session hydration is abortable and ignores stale responses so a delayed initial request cannot overwrite a newer signed-in state. Old `/#access` URLs return to the homepage top.

| Component                                           | Responsibility                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/`                                              | TypeScript UI, charts, forms and same-origin API requests. Vite proxies `/api` locally.                         |
| `src/pages/Landing.tsx`, `src/landing.css`          | Public scrolling website, sections, product example and FAQ; no API dependency.                                 |
| `src/pages/Auth.tsx`, `src/auth.css`                | Separate sign-in, registration and fictional demo pages.                                                        |
| `api/index.mjs`, `server/vercel.mjs`, `vercel.json` | Vercel function startup, required configuration and static/API routing.                                         |
| `server/`                                           | Authentication, household access, prescriptions, schedules, records, notification evaluation and audit history. |
| `server/store-postgres.mjs`                         | PostgreSQL records, idempotent schema setup and transaction/advisory-lock coordination.                         |
| `server/intelligence-node.mjs`                      | Vercel OCR, prescription parsing and rules-based attention scoring.                                             |
| `services/intelligence/`                            | Python/FastAPI OCR and scoring for local and Docker deployments.                                                |
| `scripts/dev.mjs`                                   | Local service startup, health checks and shutdown.                                                              |
| `scripts/setup.sh`                                  | Node dependencies, Python environment and frontend build.                                                       |

Local development uses Express and FastAPI/native Tesseract. Storage prefers PostgreSQL, then MongoDB, with SQLite available when neither is configured. Docker retains separate API/Python services; the optional Render profile supervises both in one container. These modes use a running reminder worker, while Vercel evaluates reminders when requests arrive.

## Storage and access

Each account belongs to one household. Caregivers manage the plan, patients record doses/symptoms, and clinicians review records and resolve follow-ups. Invitations assign membership and role. The API checks sharing consent.

PostgreSQL, MongoDB and SQLite use AES-256-GCM encrypted record payloads. Identifiers, record kinds and household indexes remain unencrypted metadata. Vercel requires PostgreSQL or MongoDB for persistence and coordination across function instances; local SQLite requires one API process.

Neon PostgreSQL through the Vercel integration is the preferred hosted setup. `DATABASE_URL` takes precedence over `POSTGRES_URL`, then `MONGODB_URI`. The `recovertrack_records` table and its household index are created idempotently at initialization. Transaction advisory locks coordinate mutations across instances. The integration supplies its connection variable; the encryption key remains a separate private setting. Switching connections does not migrate, reset or delete data in another database.

## Scheduling and review

Courses use explicit local times, start date, duration and an IANA timezone. Dose IDs derive from medication ID and scheduled timestamp. Updates remove future unrecorded doses while retaining past reports. Nonexistent daylight-saving times are rejected.

OCR fields remain editable drafts until all required values are reviewed and confirmed. Images are not retained after extraction; draft text is removed after confirmation. Prescription history stores uploaded records and version metadata without automatic reconciliation.

## Scoring

Attention rules expose the recorded inputs behind each score. Insufficient history returns an unavailable result. The weights are documented in the [intelligence service](../services/intelligence/README.md) and have not been clinically validated. Scoring receives dose timestamps/statuses and pain/mobility reports without patient names or free-text notes.

Trained risk models, a medication lexicon, hospital-wide membership and external outreach require separate implementation and validation. Local Python also offers an optional TrOCR adapter with a verified local model; Vercel uses bundled English Tesseract.js.

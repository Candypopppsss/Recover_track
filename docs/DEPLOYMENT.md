# Deployment

## Vercel — full app

The root `vercel.json` builds the Vite frontend and routes `/api` requests to `api/index.mjs`. The Express API runs as a Node.js function with a 60-second maximum duration. OCR and attention scoring run in Node; this deployment does not start Python, a native Tesseract process or a persistent reminder worker.

### Setup

1. Create a MongoDB database and a database user with read/write access to `recovertrack`. Atlas Free is sufficient for a small personal demo within its storage and connection limits.
2. Import the repository through [Vercel's new-project page](https://vercel.com/new). Use the repository root, Vite framework preset and the checked-in configuration.
3. Add `MONGODB_URI` and `DATA_ENCRYPTION_KEY` in the project's private environment settings. Set the variables for every environment you intend to run. Do not prefix them with `VITE_`, which would expose them to browser code.
4. Permit the deployment's outbound database connections in MongoDB's network settings. Vercel Hobby functions do not provide a fixed outbound IP; choose a network policy appropriate to the database rather than copying a local development allowlist.
5. Deploy, then verify registration/login, a reviewed OCR upload, dose recording and persistence through the assigned HTTPS address. Redeploy after changing runtime variables.

Generate the encryption key once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` in a private terminal, then save it securely in Vercel and a protected backup. The output is a secret; do not put it in Git or chat. Regenerating the key on redeployment makes existing records unreadable. Reusing an existing database requires its original encryption key.

The API rejects startup without MongoDB and a valid key. It does not fall back to SQLite on Vercel's temporary filesystem. `server/vercel.mjs` sets `COOKIE_SECURE=true` and `TRUST_PROXY=1`; no internal-service token is needed because OCR/scoring run in process. The same-origin `/api` routes avoid cross-host cookie setup.

### Runtime limits

- Uploads are limited to 4 MB, leaving room for multipart overhead under the function request limit. Resize larger photos or enter medication details manually.
- OCR uses Tesseract.js/WASM with bundled English data. No external OCR provider, model download or Python host is needed. Cold starts and OCR must fit within the 60-second function duration.
- MongoDB stores accounts, sessions, drafts, schedules and records. Database-backed coordination protects mutations across function instances. Treat Atlas storage/connection quotas as operating limits, not a reason to use temporary local storage.
- Reminders are request-driven. An open app polls for updates; no reminders run when there are no requests, and no background notification is delivered to a closed app.
- Vercel Hobby is intended for personal, non-commercial use and is subject to function, transfer and build quotas. Atlas Free also has quotas and inactivity policies. Account availability and provider rules can change; neither tier guarantees uninterrupted operation or permanent free hosting.

The repository contains deployment configuration. A successful local build or emulator check does not establish a live Vercel deployment or database connection. Verify the actual project URL and persistence before sharing it.

## Local and Docker deployments

`npm run dev` starts Vite, Express and Python locally. `npm start` serves the compiled frontend through the API and starts Python unless `INTELLIGENCE_URL` is supplied. The supervisor loads an ignored `.env` file when present. Local SQLite is suitable for development; retain its key and database together.

The root Dockerfile packages the frontend/API; `services/intelligence/Dockerfile` packages Python and Tesseract. `compose.production.yaml` adds Caddy and automatic HTTPS to the base `compose.yaml`.

On a Docker server, point a domain at the host, allow inbound TCP 80/443 and supply these privately:

- `APP_DOMAIN`: the public DNS hostname, without scheme or path.
- `ALLOWED_ORIGINS`: the corresponding HTTPS origin.
- `DATA_ENCRYPTION_KEY`: the persistent base64-encoded 32-byte key.
- `INTERNAL_SERVICE_TOKEN`: a shared API/Python authorization secret.

```bash
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up --build -d
docker compose -f compose.yaml -f compose.production.yaml ps
```

SQLite persists in a named volume. Python and the database have no public ports, and the API's host port is loopback-only. The overlay enables secure cookies and trusts the Caddy proxy hop. Verify certificate issuance, login, OCR and saved records through the actual domain. Do not use `down --volumes` when retaining records or certificates.

For an existing same-host HTTPS proxy, use the base Compose file and proxy to loopback port 3001. Dockerfiles accept a trusted corporate CA bundle with `--secret id=build_ca,src=/path/to/ca-bundle.pem`; it is mounted only during package installation. Keep TLS verification enabled.

### Optional Render profile

`render.yaml` and `Dockerfile.render` retain the single-container Node/Python deployment. The Blueprint requests a Free Docker service, no disk, and external MongoDB. Supply `MONGODB_URI`, retain its generated `DATA_ENCRYPTION_KEY`, and allow the Render service's outbound network in Atlas. The launcher refuses temporary SQLite storage.

Render may require card verification even for a Free service. Free instances sleep after inactivity, suspending the reminder worker, and service/storage/transfer quotas apply. This is a secondary hosting option; it is not required by the Vercel deployment.

### Existing external backend

If a separate HTTPS API already exists, `npm run configure:vercel` can generate the older frontend-proxy configuration under ignored `.vercel/`. Set the non-secret `RECOVERTRACK_API_ORIGIN` to that backend and deploy with `--local-config .vercel/deploy.json`. Configure that backend's allowed browser origin and secure cookies. This is an alternative to the default full-app Vercel configuration.

## Configuration reference

| Variable | Scope and purpose |
| --- | --- |
| `MONGODB_URI` | Required on Vercel and Render; optional for local/Docker MongoDB. |
| `MONGODB_DATABASE` | Database name; default `recovertrack`. |
| `DATA_ENCRYPTION_KEY` | Required stable key for hosted records; optional locally if a key file is used. |
| `COOKIE_SECURE` / `TRUST_PROXY` | Enabled by the Vercel/Render entrypoints; configure explicitly behind other trusted HTTPS proxies. |
| `ALLOWED_ORIGINS` | Accepted browser origins for mutations; needed for a separate frontend/backend deployment. |
| `PORT` / `API_PORT`, `API_HOST` | Long-running API port/interface; defaults 3001 and `0.0.0.0`. |
| `DATA_DIR` | Local database/key directory; default `.data`. Vercel does not use it for durable records. |
| `INTELLIGENCE_PORT`, `INTELLIGENCE_URL` | Local Python port (default 8001) or an existing private service URL. Not required by the Vercel adapter. |
| `INTERNAL_SERVICE_TOKEN` | Shared authorization secret for separate Node/Python services. Not required by the in-process Vercel adapter. |
| `RECOVERTRACK_PYTHON` | Local Python executable; defaults to `.venv/bin/python` if present. |
| `OCR_ENGINE` / `TROCR_MODEL_PATH` | Local Python OCR engine and optional verified TrOCR model. Vercel uses bundled Tesseract.js English. |

## Publication and operations

Run `npm run build` and `npm run check:secrets` before publication. The guard checks staged/tracked blobs and build assets; stage intended files before scanning. It rejects staged/tracked environment files, examples, private keys, local databases and common credential patterns.

Back up MongoDB data and the encryption key under separate access controls. Test restoration with the original key. Changing the key variable alone is not key rotation: existing records require a decrypt/re-encrypt migration. Record payload encryption does not encrypt index metadata.

For SQLite, use one API process and a transaction-consistent backup, or stop the process before copying database/WAL files. Restrict database users and network access to the chosen hosting policy, and monitor connection, storage and OCR failures.

## Before real patient use

This build lacks clinician MFA, verified staff onboarding and clinical validation. A deployer must also establish privacy/retention/deletion procedures, backup restoration, secret management, failure monitoring and responsibility for reviewing attention flags. The project does not claim legal certification or clinical effectiveness.

Background push, email, WhatsApp and calls require a provider, consent, durable delivery queue, retries and receipts. Do not label queued notifications as delivered. Review data-use terms before sending prescriptions to an external provider.

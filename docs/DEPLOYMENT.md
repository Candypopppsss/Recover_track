# Deployment

## Vercel — full app

The root `vercel.json` builds the Vite frontend and routes `/api` requests to `api/index.mjs`. The Express API runs as a Node.js function with a 60-second maximum duration. OCR and attention scoring run in Node; this deployment does not start Python, a native Tesseract process or a persistent reminder worker.

### Neon setup

1. Import the repository through [Vercel's new-project page](https://vercel.com/new), or use the existing project. Use the repository root, Vite framework preset and checked-in configuration.
2. Open the project's **Storage** tab, choose **Create Database**, and select **Neon** from the database integrations.
3. Select **Neon Free** explicitly. Connect the database to this Vercel project with the default environment-variable names and enable **Production**. Enable Preview separately if needed. Do not select a paid plan or time-limited trial; if Free is unavailable for the account, do not proceed with a paid substitute.
4. The integration supplies `DATABASE_URL` to the connected environment. The app also accepts `POSTGRES_URL`. Leave the supplied TLS/SSL connection settings intact. Never prefix database or encryption variables with `VITE_`, which would expose them to browser code.
5. In **Settings → Environment Variables**, add a stable `DATA_ENCRYPTION_KEY` for the same environments: a canonical base64-encoded 32-byte key. For a new store, open `/deployment-key.html` on the deployed app to generate and copy one privately in your browser. If a valid key already exists, keep it. Save a protected backup.
6. **Redeploy** the project so the function receives the new variables. Connecting storage does not update a deployment that is already running.
7. Open `/api/health` through the deployed HTTPS app. Expect HTTP 200 with `database: "postgresql-encrypted"`, then test registration/login, reviewed OCR upload, dose recording and persistence after another deployment.

The [browser setup helper](https://recovertrack-pink.vercel.app/deployment-key.html) works independently of the API. It generates 32 random bytes with Web Crypto only after an explicit click, masks the value and copies it only when requested. Its content security policy blocks network connections; the page does not store the key, and clears its field when you leave. Copy it directly into Vercel's private settings and your password manager. Never put it in Git or chat. Use the original key for existing records: changing the key makes those records unreadable.

The PostgreSQL adapter creates its tables and indexes idempotently during initialization; there is no manual SQL setup. Neon handles database connectivity through the integration, without the MongoDB Atlas IP-allowlist setup. This does not remove the need to protect the database credentials.

### Database selection and existing data

The app prefers `DATABASE_URL`, then `POSTGRES_URL`, then `MONGODB_URI`. When PostgreSQL and MongoDB variables are both present, PostgreSQL is used. Local development falls back to SQLite only when no hosted database is configured; Vercel never falls back to temporary local storage.

Connecting a new Neon database starts with an empty record store. Existing MongoDB or SQLite records are neither copied nor deleted. Keep the original database and key if those records are needed, and plan an explicit migration instead of resetting storage. A PostgreSQL connection string and a MongoDB connection string are not interchangeable.

`server/vercel.mjs` requires a hosted database and a valid encryption key, enables `COOKIE_SECURE=true` and `TRUST_PROXY=1`, and uses in-process OCR/scoring. No Python service token is needed. The same-origin `/api` routes avoid cross-host cookie setup.

### Initialization errors

A page loading successfully only confirms the frontend was served. A generic initialization error alone does not identify which setting failed. This version returns HTTP 503 with a non-secret `code` when initialization fails:

| Code | Check |
| --- | --- |
| `storage_config_missing` | A supported database URL is missing or invalid. Connect Neon to this project/environment. |
| `encryption_key_missing` | The key is missing or not a canonical base64-encoded 32-byte value. |
| `database_unreachable` | Initialization did not complete. Check connection settings, provider availability and function logs. |

- Check that `DATABASE_URL` or `POSTGRES_URL` is present in the environment used by the deployment, especially **Production** versus **Preview**. Check presence without sharing the value.
- Check that `DATA_ENCRYPTION_KEY` decodes to exactly 32 bytes and is the original key for any existing encrypted data.
- Confirm that the Neon database is connected to this Vercel project, then redeploy after changing variables.
- Use the deployed `/api/health` response and Vercel function logs to check initialization. A logged-out `/api/state` returning 401 is expected once health succeeds.

The redesigned frontend is deployed at [recovertrack-pink.vercel.app](https://recovertrack-pink.vercel.app/). Its API currently reports `encryption_key_missing`; the deployment needs a valid private key before database connectivity and live workflows can be verified. These instructions alone do not establish a live Neon connection. Verify actual health and data persistence before sharing the app as ready.

### Runtime limits

- Uploads are limited to 4 MB, leaving room for multipart overhead under the function request limit. Resize larger photos or enter medication details manually.
- OCR uses Tesseract.js/WASM with bundled English data. No external OCR provider, model download or Python host is needed. Cold starts and OCR must fit within the 60-second function duration.
- PostgreSQL stores accounts, sessions, drafts, schedules and records. Database-backed coordination protects mutations across function instances. Keep within the provider's storage, compute and connection quotas.
- Reminders are request-driven. An open app polls for updates; no reminders run when there are no requests, and no background notification is delivered to a closed app.
- Vercel Hobby is intended for personal, non-commercial use and has function, transfer and build quotas. Neon Free has compute, storage and connection limits. Eligibility has not been checked for the current accounts. Neither tier guarantees uninterrupted operation or permanent free hosting, and this setup does not authorize an upgrade, payment or trial.

## Local and Docker deployments

`npm run dev` starts Vite, Express and Python locally. `npm start` serves the compiled frontend through the API and starts Python unless `INTELLIGENCE_URL` is supplied. The supervisor loads an ignored `.env` file when present. Storage uses the same PostgreSQL → MongoDB → SQLite selection described above. Retain a local SQLite key and database together.

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
| `DATABASE_URL` / `POSTGRES_URL` | Preferred PostgreSQL connection, normally supplied by the Vercel/Neon integration. `DATABASE_URL` takes precedence. |
| `MONGODB_URI` | Existing MongoDB alternative when no PostgreSQL connection is configured. Required by the retained Render profile. |
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

Back up database records and the encryption key under separate access controls. Test restoration with the original key. Changing the key variable alone is not key rotation: existing records require a decrypt/re-encrypt migration. Record payload encryption does not encrypt index metadata.

For SQLite, use one API process and a transaction-consistent backup, or stop the process before copying database/WAL files. Restrict database users and network access to the chosen hosting policy, and monitor connection, storage and OCR failures.

## Before real patient use

This build lacks clinician MFA, verified staff onboarding and clinical validation. A deployer must also establish privacy/retention/deletion procedures, backup restoration, secret management, failure monitoring and responsibility for reviewing attention flags. The project does not claim legal certification or clinical effectiveness.

Background push, email, WhatsApp and calls require a provider, consent, durable delivery queue, retries and receipts. Do not label queued notifications as delivered. Review data-use terms before sending prescriptions to an external provider.

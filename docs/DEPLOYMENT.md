# Deployment

## Configuration

`npm run dev` runs the local services. `npm start` serves the compiled frontend through the API and starts Python unless `INTELLIGENCE_URL` is supplied. The supervisor loads an ignored `.env` file when present.

| Variable | Purpose |
| --- | --- |
| `PORT` / `API_PORT` | API port; default 3001. |
| `API_HOST` | API interface; default `0.0.0.0`. |
| `COOKIE_SECURE` | Set `true` for HTTPS production sessions. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins accepted for mutations. |
| `TRUST_PROXY` | Set `1` only behind a trusted reverse proxy. |
| `INTELLIGENCE_PORT` | Supervised Python port; default 8001. |
| `INTELLIGENCE_URL` | Existing private service URL; disables local Python startup. |
| `INTERNAL_SERVICE_TOKEN` | Shared API/Python secret. Generated per process group for local development. |
| `DATA_DIR` | Persistent database/key directory; default `.data`. |
| `DATA_ENCRYPTION_KEY` | Optional base64-encoded 32-byte key. Otherwise stored in `DATA_DIR/encryption.key`. |
| `MONGODB_URI` / `MONGODB_DATABASE` | Optional private MongoDB connection and database; default database `recovertrack`. |
| `RECOVERTRACK_PYTHON` | Python executable; defaults to `.venv/bin/python` if present. |
| `OCR_ENGINE` / `TROCR_MODEL_PATH` | Default `tesseract`, or `trocr` with a verified local model and dependencies. |

Store secrets outside the repository. For production, set `COOKIE_SECURE=true`, configure the public origin and terminate TLS at the reverse proxy. `NODE_ENV=production` does not enforce HTTPS.

## Docker deployment

The root Dockerfile packages the frontend/API; `services/intelligence/Dockerfile` packages Python and Tesseract. Runtime image inputs are explicit, so local data and credentials are not copied into them. SQLite persists in a named volume; Python and the database have no public ports.

For a public deployment, use a Docker-capable Linux server with the Compose plugin and a domain whose DNS points to that server. The host must accept inbound TCP ports 80 and 443; UDP 443 is optional for HTTP/3. `compose.production.yaml` adds Caddy, automatic HTTPS and persistent certificate storage. The API's host port remains loopback-only.

Supply these through the host's deployment environment or secret manager, outside the repository:

- `APP_DOMAIN`: the actual public DNS hostname, without a scheme or path.
- `ALLOWED_ORIGINS`: the corresponding exact HTTPS origin.
- `DATA_ENCRYPTION_KEY`: a persistent base64-encoded 32-byte encryption key.
- `INTERNAL_SERVICE_TOKEN`: one private random token shared by the API and Python.

Then run from the checkout on that host:

```bash
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up --build -d
docker compose -f compose.yaml -f compose.production.yaml ps
```

The overlay enables secure cookies and trusts the Caddy proxy hop. Caddy obtains a public certificate only after the real domain resolves correctly and certificate validation can reach the host. Verify HTTPS, login, OCR and persisted records through the actual domain before calling deployment complete. Do not use `down --volumes` when retaining patient records or certificates.

Do not regenerate the encryption key on startup: existing records would become unreadable. Keep a protected backup of the key and data. Set `MONGODB_URI` to use managed MongoDB instead of SQLite; keep the database private and retain the same record-encryption key.

For an existing same-host HTTPS proxy, use the base `compose.yaml` and route that proxy to loopback port 3001. For a corporate build proxy, Dockerfiles accept a trusted CA bundle using `--secret id=build_ca,src=/path/to/ca-bundle.pem`. The bundle is mounted only during package installation. Forward proxy settings through Docker's supported build arguments and keep TLS verification enabled.

The full stack passed local container checks, and the merged production Compose/Caddy configuration validates. No public host, DNS record, HTTPS certificate or live deployment was created by those checks. A live URL requires access to the actual hosting server/account and domain.

## Vercel frontend

The current backend needs persistent storage, an OCR binary and a running reminder worker; it cannot use the frontend's Vercel runtime unchanged. Keep the API/Python containers on a host and route Vercel requests to that backend.

Set the non-secret `RECOVERTRACK_API_ORIGIN` to the existing backend's HTTPS origin, then run:

```bash
npm run configure:vercel
npx vercel@65.2.0 login
npx vercel@65.2.0 deploy --prod --local-config .vercel/deploy.json
```

The generated config stays in ignored `.vercel/`. It routes `/api` to the backend before applying the SPA fallback. Configure `ALLOWED_ORIGINS` on the backend for the actual Vercel origin and enable secure cookies. Test login, OCR and persistence through the deployed URL before treating it as a working deployment.

## Publication checks

```bash
npm run build
npm run check:secrets
```

The guard reads Git's staged/tracked blobs and build assets. It rejects environment examples, credential/key files, runtime data and common credential patterns without printing secret values. It also runs in CI. Stage the files being published before scanning; no environment template or secret value belongs in the repository.

## Operations

- Run one API process. Distributed mutation/session/reminder behavior has not been tested, including with the optional MongoDB adapter.
- Back up data and encryption keys under separate access controls. Use a transaction-consistent SQLite backup or stop the service before copying database/WAL files. Test restoration in a separate environment.
- Record payload encryption does not encrypt index metadata. Apply host/database encryption where required.
- Changing `DATA_ENCRYPTION_KEY` is not key rotation; existing records require a decrypt/re-encrypt migration.

## Before real patient use

This build lacks clinician MFA, verified staff onboarding and clinical validation. A deployer must also establish HTTPS/private networking, secret management, backup restoration, retention/deletion procedures, privacy review and an incident-response owner. Monitor storage failures and missing reminders and assign responsibility for reviewing attention flags. The project does not claim legal certification or clinical effectiveness.

Notifications currently use in-app polling. Background push, email, WhatsApp and calls need a provider, consent, a durable delivery queue, retries and delivery receipts. Do not label a queued notification as delivered. Review a vendor's data-use terms before sending prescriptions to an external service.

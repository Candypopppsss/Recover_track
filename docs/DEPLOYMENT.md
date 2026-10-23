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
| `RECOVERTRACK_REQUIRE_MONGODB` | The free Render profile sets `true` and refuses to start without MongoDB and a persistent encryption key. |
| `RECOVERTRACK_PYTHON` | Python executable; defaults to `.venv/bin/python` if present. |
| `OCR_ENGINE` / `TROCR_MODEL_PATH` | Default `tesseract`, or `trocr` with a verified local model and dependencies. |

Store secrets outside the repository. For production, set `COOKIE_SECURE=true`, configure the public origin and terminate TLS at the reverse proxy. `NODE_ENV=production` does not enforce HTTPS.

## Free Render and Atlas deployment

The default `render.yaml` requests one **Free** Docker web service and **no disk**. Accounts, sessions, reviewed prescriptions, medications and dose history use an external MongoDB Atlas **Free** cluster, formerly called M0. Atlas Free does not expire and provides 0.5 GB of storage; Render's free local filesystem is temporary. Choose the Free tier explicitly when creating both resources.

Render may still require a credit card for identity verification. Selecting Free or using this Blueprint does not bypass account verification. If card-free signup is required, this hosting route is unsuitable for an account receiving that prompt. Free service availability is also subject to sleep, quotas and provider outages.

1. Create an [Atlas Free cluster](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/). Create a database user with read/write access to the `recovertrack` database.
2. Open [the prepared Render deployment](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FCandypopppsss%2FRecover_track) and sign in. Enter the Atlas connection string privately in the requested `MONGODB_URI` field. No connection string or password belongs in Git or chat.
3. Add the outbound IP ranges shown for the Render service to Atlas's network access list. Render must be allowed to connect before its health check can pass.
4. Confirm the service is Free and has no disk or paid database attached. Deploy it, then open Render's assigned HTTPS address and check login, OCR review and saved records.

Render generates a stable base64-encoded 32-byte `DATA_ENCRYPTION_KEY` and a shared `INTERNAL_SERVICE_TOKEN` in its private environment. Keep the encryption key unchanged across redeployments and retain a protected backup with the database. Connecting an existing database to a new Render service requires its original encryption key. The free launcher refuses to start without a valid key and MongoDB URI, preventing a silent fallback to temporary SQLite storage.

`Dockerfile.render` runs the compiled frontend/API and supervised Python/Tesseract in one container. Render supplies an HTTPS `onrender.com` address; a custom domain is optional. The launcher uses `RENDER_EXTERNAL_URL`, respects `PORT`, enables secure cookies and keeps Python on loopback. Node, Python and OCR run as an unprivileged user. Prescription images are processed in memory; extracted drafts and reviewed records are stored in MongoDB. The original image is not retained.

[Render Free](https://render.com/docs/free) sleeps after 15 minutes without inbound traffic; waking takes about a minute. Background reminders cannot run while it sleeps. Its 750 monthly instance hours are shared across the workspace, and bandwidth/build quotas apply. Exceeding quotas can suspend the service; with a payment method configured, some usage overages can be billed. This profile is intended for a free project demo, with no continuous-availability promise. Atlas can also pause a Free cluster after 30 days without connections; resume it in Atlas when needed.

Keep one instance. Automatic redeployments are disabled; deploy reviewed commits after checks pass. Opening the deployment link or passing local tests does not create a public service or establish that the hosted database is reachable.

## Existing Docker server

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

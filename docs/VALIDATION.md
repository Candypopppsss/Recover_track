# Testing

Run from the repository root after `bash scripts/setup.sh`:

```bash
npm run typecheck
npm test
.venv/bin/python -m unittest discover -s services/intelligence -p 'test_*.py'
npm run test:e2e
npm run build
```

Playwright starts the development stack if one is not running. It uses system Chromium when available; other hosts may need `npx playwright install chromium` and browser OS dependencies. CI runs these suites and retains browser traces/screenshots on failure.

| Suite | Cases | Coverage |
| --- | ---: | --- |
| Node | 35 | API access, review gates, scheduling/timezones, duplicate mutations, consent, invitations, restart persistence, secret guards and Vercel/Render deployment configuration. |
| MongoDB 8 | 7 | Encrypted CRUD, deletion of all local files, stable key requirements, access restrictions, sharing consent and concurrent mutation protection. |
| Python | 21 | OCR/parser validation, service authorization and attention-rule boundaries. |
| Browser | 8 | Auth, invitations, review/confirmation, medication management, check-ins, settings, exports and mobile navigation. |

The recorded suites passed **71 tests: 35 Node, 7 MongoDB, 21 Python and 8 browser scenarios**, with no failures or skipped cases. Node and MongoDB suites were rerun for the free deployment; API, Python and browser source remained unchanged.

Run `npm run test:mongo` with `RECOVERTRACK_TEST_MONGODB_URI` pointing to a disposable MongoDB 8 server. This separate suite uses random test databases and deletes them afterward; missing connection settings cause a failure rather than a skipped run. CI runs it with a loopback-only MongoDB service. Its OCR responses are storage fixtures; actual OCR is covered by Python and container checks.

Managed Atlas connectivity, external delivery, production TLS/MFA and clinical outcomes are not covered by these suites.

## Docker verification

Both final images built with TLS verification enabled. Fourteen full-stack container checks passed, covering:

- Images exclude checked credential/config paths, local database records, runtime secrets and the build-only CA bundle.
- Compose validates; API and private Python/Tesseract start, and both Docker health checks become healthy.
- The production frontend/assets, protected state, Secure/HttpOnly session cookie and private attention service work.
- A real fictional prescription upload invokes Tesseract; unreviewed confirmation is rejected, reviewed confirmation creates five doses, and duplicate confirmation is rejected.
- Patient/clinician writes and cross-household access are rejected by the API.
- Removing and replacing the API container preserves its session, confirmed prescription, medication and doses through the named data volume and unchanged encryption key. Checked fixture names are absent from the stored ciphertext, and the supplied key is not written into the volume.

Only a temporary loopback port was published. All verification containers, networks and data volumes were removed afterward; built images remain local. The production overlay preserves loopback-only API access and private Python, and its Caddy configuration validates. No public host, domain, certificate issuance or external deployment was exercised. MongoDB, external notification delivery and clinical behavior remain outside these checks.

## Render container verification

The combined `Dockerfile.render` image passed 11 local container checks with a 512 MiB memory limit and no swap. These covered production assets, secure authentication, actual Tesseract OCR, mandatory review, duplicate/access rejection and records surviving container replacement. A fresh root-owned disk started successfully after the narrow ownership bootstrap; Node/Python ran as UID 10001, and the generated encryption key retained mode `0600` and survived replacement.

Peak memory during the original SQLite OCR scenario was 147,214,336 bytes (about 140.4 MiB), with no OOM termination. This measures the tested scenario, not production load capacity. The temporary containers, volume and bind directory were removed. The current Blueprint passes Render's [published JSON schema](https://render.com/schema/render.yaml.json) with `plan: free` and no disk. Account-specific resource creation and a public deployment still require hosting-account access.

## Free profile verification

Seven additional container checks passed with **0.1 CPU, 512 MiB RAM and no swap**, using MongoDB 8 outside the API container and a stable environment encryption key. Actual Tesseract extraction took 6.093 seconds. Startup took 41.283 seconds and replacement took 39.351 seconds, including Docker creation/readiness. Peak memory was 161,554,432 bytes (about 154.1 MiB), with no OOM termination.

The replacement discarded the entire API container and `.data` directory. The account, session, confirmed prescription, medication and five doses remained accessible through MongoDB; no local key, SQLite database or uploaded image was needed. All temporary API/MongoDB containers, networks and test data were removed. This tests one fictional card locally; managed Atlas authentication/networking, Render cold starts and production load remain unverified until actual hosting accounts are connected.

## OCR evaluation

Run `.venv/bin/python scripts/evaluate-ocr.py`. The generated printed-card test matched all five fields on **13/20 cases** before review. [Per-field and per-case results](OCR_EVALUATION.md) include the failures. This does not measure handwriting accuracy or human correction time.

## Human review study — pending

The proposed study uses the [20 reference cases](../tests/ocr/references.json): ten clear and ten difficult variants. Five volunteers review four cases each. Independently check the reference fields, counterbalance manual/app order, and include failed reads and retakes.

Measure drug, strength, dose, frequency and duration before and after review. Time correction from draft display to confirmation; report median and P90. The pass rule requires **all fields correct after review and every case below 30 seconds**. Also measure complete setup time, including reminders. These human-study targets have not been tested.

## Manual release checks

- Verify unreviewed drafts cannot schedule doses and repeated confirmation cannot duplicate them.
- Check timezone, duration and explicit dose times against the reviewed plan.
- Verify shared access and consent revocation from a second account.
- Stop Python and confirm manual entry remains available while OCR/attention report unavailability.
- Restore a backup with its key and verify records, sessions and history.

Deployment checks are listed in [DEPLOYMENT.md](DEPLOYMENT.md).

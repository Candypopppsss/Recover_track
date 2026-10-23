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
| Node | 29 | API access, review gates, scheduling/timezones, duplicate mutations, consent, invitations, restart persistence, secret guards and deployment configuration. |
| Python | 21 | OCR/parser validation, service authorization and attention-rule boundaries. |
| Browser | 8 | Auth, invitations, review/confirmation, medication management, check-ins, settings, exports and mobile navigation. |

The final run passed **58 tests: 29 Node, 21 Python and 8 browser scenarios**, with no failures or skipped cases.

MongoDB, external delivery, production TLS/MFA and clinical outcomes are not covered by these tests.

## Docker verification

Both final images built with TLS verification enabled. Fourteen full-stack container checks passed, covering:

- Images exclude checked credential/config paths, local database records, runtime secrets and the build-only CA bundle.
- Compose validates; API and private Python/Tesseract start, and both Docker health checks become healthy.
- The production frontend/assets, protected state, Secure/HttpOnly session cookie and private attention service work.
- A real fictional prescription upload invokes Tesseract; unreviewed confirmation is rejected, reviewed confirmation creates five doses, and duplicate confirmation is rejected.
- Patient/clinician writes and cross-household access are rejected by the API.
- Removing and replacing the API container preserves its session, confirmed prescription, medication and doses through the named data volume and unchanged encryption key. Checked fixture names are absent from the stored ciphertext, and the supplied key is not written into the volume.

Only a temporary loopback port was published. All verification containers, networks and data volumes were removed afterward; built images remain local. The production overlay preserves loopback-only API access and private Python, and its Caddy configuration validates. No public host, domain, certificate issuance or external deployment was exercised. MongoDB, external notification delivery and clinical behavior remain outside these checks.

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

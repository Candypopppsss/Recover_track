# RecoverTrack API

The browser uses same-origin `/api` requests with an HttpOnly session cookie. Vite proxies these during development. Errors are JSON `{ "error": "message" }`. Patient-local calendar dates use `YYYY-MM-DD`; timestamps use ISO UTC and the profile stores an IANA timezone. Access is scoped to one authorized household per account. The Python intelligence API is private and requires the shared `x-internal-token` header when configured.

## Authentication

| Method and route | Body | Behavior |
| --- | --- | --- |
| GET `/auth/me` | — | Current user, patient and demo flag; sharing consent is checked. |
| POST `/auth/register` | `name, email, password, patientName, surgery?, timeZone?` | Creates an empty caregiver-owned household; password minimum 10 characters. |
| POST `/auth/login` | `email, password` | Creates a fresh session. |
| POST `/auth/demo` | `role?: caregiver\|patient\|doctor` | Creates an isolated household with clearly fictional seeded records. |
| POST `/auth/logout` | `{}` | Invalidates the current session. |

Demo accounts cannot invite or join real households. New personal accounts cannot self-assign clinician roles; they must accept a caregiver-created invitation.

## Recovery records

GET `/state` returns `user, demo, patient, medications, doses, checkIns, prescriptions, notifications, activity, risk, settings, consent, careTeam, callbacks, auditLog`. Doses cover the previous 14 days and the coming 7 days. Patient views do not receive the audit log. Read operations are audited. The frontend polls every 30 seconds; the reminder worker also runs every 30 seconds while the API process is running.

| Method and route | Body | Permission and behavior |
| --- | --- | --- |
| POST `/medications` | Medication fields + `reviewed:true` | Caregiver; creates one reviewed schedule. |
| POST `/medications/batch` | `{medications:[...]}` | Caregiver; validates every medication before creating any schedules. |
| PATCH `/medications/:id` | Editable fields, `reviewed:true`; or `status` alone | Caregiver; changing prescribed fields requires review again. Preserves historical dose records. |
| DELETE `/medications/:id` | — | Caregiver; archives medication and removes future unrecorded doses. |
| POST `/doses/:id/check-in` | `status: taken\|skipped, note?` | Patient/caregiver; duplicate recording returns 409. Doses more than one hour in the future cannot be recorded. |
| POST `/doses/:id/undo` | `{}` | Patient/caregiver; corrects an existing report and audits the correction. |
| POST `/checkins` | `pain:0..10, mobility:resting\|assisted\|independent, note?, date?` | Patient/caregiver; one record per patient-local day, repeat submissions update that record. Today or previous 14 days only. |
| PATCH `/patient` | `name?, age?, surgery?, recoveryStart?, recoveryDays?, timeZone?` | Caregiver; pause active medications before a timezone change, then review/reactivate them. |
| PATCH `/settings` | `remindersEnabled?, missedAlertsEnabled?, graceMinutes?` | Caregiver; grace period 15–120 minutes. |
| PATCH `/consent` | `app?, caregiver?, clinician?, outreach?` | Caregiver; app consent withdrawal pauses new recording, reminders and attention processing. Owner retains read/export access. Revoked sharing blocks invited caregiver/clinician access. |
| POST `/notifications/read` | `{ids?:string[]}` | Marks selected notifications read; omission marks all. |
| POST `/callbacks/:id/resolve` | `{note?}` | Caregiver/clinician; resolves a household callback. Resolved callbacks do not reopen for unchanged attention on the same local day. |
| GET `/export` | — | Authorized household dose history as CSV, including spreadsheet-formula mitigation. |

A medication contains `name, strength, dose, instructions, times:string[], startDate, durationDays, color`. Times are explicit 24-hour local times; duration is 1–90 days. Color is `purple|green|amber|blue`. Status is `active|paused|completed`. A check-in records a report, not proof of ingestion. Scheduling rejects nonexistent local times at daylight-saving transitions rather than silently shifting them.

## Prescription review

1. POST `/prescriptions/upload` with multipart field `file`. Accepts valid PNG/JPEG/WebP images up to 10 MB. Returns a draft with actual OCR text, candidate medication fields, extracted frequency, engine, warning, optional engine confidence and critical-field review flag. Exact dose times are left blank unless explicitly present. No schedule is created.
2. Correct every field against the original prescription. OCR confidence is an engine signal, not calibrated medical correctness. It is separate from a critical-field review flag.
3. POST `/prescriptions/:id/confirm` with `{medications:[{...fields,reviewed:true}],criticalityFlag?}`. Every medication and schedule is validated before saving. Confirmation is single-use. Raw OCR draft text is removed after confirmation; original images are never stored long term.

Prescription history retains separate uploaded records and version metadata. This version does not perform clinical prescription comparison or automatic medication reconciliation.

## Care-circle invitations

POST `/care-team/invitations` with `{role:caregiver|patient|doctor,email?}` creates a hashed, single-use code valid for 48 hours. Caregiver/clinician sharing must be enabled for those roles. The returned `{code,expiresAt}` is shared privately by the user; no email is sent.

An authenticated personal account with no existing recovery records accepts using POST `/care-team/join` with `{code}`. Optional email binding is enforced. Joining changes its household and role and rotates the session. This implementation supports one household per account and one API process; it does not implement hospital-wide identity/membership management or distributed write locking.

## Intelligence service

- GET `/health`: OCR availability and scoring method. Readiness metadata is public within the private service network.
- POST `/ocr`: multipart `file`; actual local Tesseract by default. Optional TrOCR requires preinstalled verified local model/dependencies. Incomplete/ambiguous fields remain empty. The local OCR operation times out after 45 seconds.
- POST `/risk`: de-identified `{doses:[{scheduledAt,status}],checkIns:[{date,pain,mobility}],timeZone}`. Returns `{score,level,explanation,features,experimental:true,modelVersion}`. Level is `low|moderate|high|unavailable`. Insufficient recent records return a null score. The rules-based score highlights recorded patterns for human review; it is not a complication probability or medication instruction.

GET `/api/health` reports the API database and OCR service status. When intelligence is unavailable, manual medication entry and record keeping remain useful; OCR returns an actionable error and attention is explicitly unavailable.

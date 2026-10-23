import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../server/app.mjs";
import { addDays, dateInZone } from "../server/scheduling.mjs";

async function setup(t) {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "recovertrack-dose-range-"),
  );
  const app = await createApp({
    dataDir,
    memory: true,
    postgresUri: null,
    mongoUri: null,
    startWorker: false,
    serveStatic: false,
    test: true,
    intelligenceRequest: async () =>
      Response.json({
        score: null,
        level: "unavailable",
        explanation: ["Fictional schedule test."],
        experimental: true,
        modelVersion: "test",
      }),
  });
  t.after(async () => {
    await app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, owner: request.agent(app) };
}
const account = (email) => ({
  name: "Fictional caregiver",
  email,
  password: "fictional-schedule-passphrase",
  patientName: "Fictional recovery patient",
  timeZone: "Asia/Kolkata",
});
const today = () => dateInZone(new Date(), "Asia/Kolkata");
const course = (name, durationDays = 90) => ({
  name,
  strength: "5 mg",
  dose: "1 tablet",
  instructions: "Fictional range test",
  times: ["00:00", "23:59"],
  startDate: today(),
  durationDays,
  color: "green",
  reviewed: true,
});

test("dose range reads require authentication and reject missing, invalid or overlong ranges", async (t) => {
  const { app, owner } = await setup(t);
  await request(app)
    .get("/api/doses")
    .query({ from: today(), to: today() })
    .expect(401);
  await owner
    .post("/api/auth/register")
    .send(account("range-validation@fictional.test"))
    .expect(201);
  assert.equal(
    (await owner.get("/api/state").expect(200)).body.doseRange,
    null,
  );
  for (const query of [
    {},
    { from: today() },
    { to: today() },
    { from: "2026-02-30", to: today() },
    { from: today(), to: "invalid" },
    { from: today(), to: addDays(today(), -1) },
    { from: today(), to: addDays(today(), 31) },
    { from: [today(), today()], to: today() },
    { from: today(), to: today(), householdId: "other-household" },
  ])
    await owner.get("/api/doses").query(query).expect(400);
  const accepted = await owner
    .get("/api/doses")
    .query({ from: today(), to: addDays(today(), 30) })
    .expect(200);
  assert.deepEqual(accepted.body, { doses: [] });
});

test("state exposes full local-date extents while dose pages stay bounded and household scoped", async (t) => {
  const { app, owner } = await setup(t),
    other = request.agent(app);
  await owner
    .post("/api/auth/register")
    .send(account("range-owner@fictional.test"))
    .expect(201);
  await other
    .post("/api/auth/register")
    .send(account("range-other@fictional.test"))
    .expect(201);
  await owner.post("/api/medications").send(course("MED-LONG")).expect(201);
  await other
    .post("/api/medications")
    .send(course("MED-FOREIGN", 2))
    .expect(201);
  const state = (await owner.get("/api/state").expect(200)).body;
  assert.deepEqual(state.doseRange, {
    from: today(),
    to: addDays(today(), 89),
  });
  assert.equal(state.doses.length, 16); // The compact state still includes only today through day +7.
  const from = addDays(today(), 83),
    to = addDays(today(), 89);
  const result = (await owner.get("/api/doses").query({ from, to }).expect(200))
    .body.doses;
  assert.equal(result.length, 14);
  assert.ok(
    result.every(
      (dose) =>
        dose.medicationName === "MED-LONG" && dose.status === "upcoming",
    ),
  );
  assert.deepEqual(
    result.map((dose) => dose.scheduledAt),
    result.map((dose) => dose.scheduledAt).sort(),
  );
  assert.deepEqual(
    [
      ...new Set(
        result.map((dose) =>
          dateInZone(new Date(dose.scheduledAt), "Asia/Kolkata"),
        ),
      ),
    ],
    Array.from({ length: 7 }, (_, i) => addDays(from, i)),
  );
  assert.deepEqual(
    (await other.get("/api/doses").query({ from, to }).expect(200)).body.doses,
    [],
  );
  assert.deepEqual((await other.get("/api/state").expect(200)).body.doseRange, {
    from: today(),
    to: addDays(today(), 1),
  });
});

test("dose pages include complete patient-local days and reflect newly recorded check-ins", async (t) => {
  const { owner } = await setup(t);
  await owner
    .post("/api/auth/register")
    .send(account("range-checkin@fictional.test"))
    .expect(201);
  await owner.post("/api/medications").send(course("MED-DAY", 2)).expect(201);
  const query = { from: today(), to: today() };
  const first = (await owner.get("/api/doses").query(query).expect(200)).body
    .doses;
  assert.equal(first.length, 2);
  assert.equal(first[0].scheduledAt.slice(0, 10), addDays(today(), -1)); // Local midnight is the prior UTC day.
  assert.ok(["due", "missed"].includes(first[0].status));
  await owner
    .post(`/api/doses/${first[0].id}/check-in`)
    .send({ status: "taken" })
    .expect(200);
  const refreshed = (await owner.get("/api/doses").query(query).expect(200))
    .body.doses;
  assert.equal(refreshed[0].status, "taken");
  assert.ok(refreshed[0].takenAt);
});

test("dose-page sharing is revoked immediately while the household owner retains read access", async (t) => {
  const { app, owner } = await setup(t),
    clinician = request.agent(app);
  await owner
    .post("/api/auth/register")
    .send(account("range-sharing-owner@fictional.test"))
    .expect(201);
  await clinician
    .post("/api/auth/register")
    .send(account("range-clinician@fictional.test"))
    .expect(201);
  await owner
    .post("/api/medications")
    .send(course("MED-SHARED", 1))
    .expect(201);
  await owner.patch("/api/consent").send({ clinician: true }).expect(200);
  const invitation = await owner
    .post("/api/care-team/invitations")
    .send({ role: "doctor", email: "range-clinician@fictional.test" })
    .expect(201);
  await clinician
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(200);
  const query = { from: today(), to: today() };
  assert.equal(
    (await clinician.get("/api/doses").query(query).expect(200)).body.doses
      .length,
    2,
  );
  await owner.patch("/api/consent").send({ clinician: false }).expect(200);
  await clinician.get("/api/doses").query(query).expect(403);
  await owner.patch("/api/consent").send({ app: false }).expect(200);
  assert.equal(
    (await owner.get("/api/doses").query(query).expect(200)).body.doses.length,
    2,
  );
});

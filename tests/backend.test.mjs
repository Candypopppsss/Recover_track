import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.mjs";
import {
  addDays,
  dateInZone,
  localDateTimeToUTC,
  generateDoses,
} from "../server/scheduling.mjs";

const risk = {
  score: 18,
  level: "low",
  explanation: ["Most scheduled doses have a check-in."],
  experimental: true,
  modelVersion: "rules-v1",
};
async function setup(t, riskResponse = risk) {
  const dir = await mkdtemp(path.join(tmpdir(), "recovertrack-test-"));
  const intelligence = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/risk") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      assert.ok(parsed.doses.every((d) => !("medicationName" in d)));
      res.end(JSON.stringify(riskResponse));
    } else if (req.url === "/ocr")
      res.end(
        JSON.stringify({
          text: "MED-A 10 mg 1 tablet 08:00 for 5 days",
          engine: "test-fixture",
          confidenceScore: 90,
          criticalityFlag: true,
          medications: [
            {
              name: "MED-A",
              strength: "10 mg",
              dose: "1 tablet",
              times: ["08:00"],
              durationDays: 5,
            },
          ],
        }),
      );
    else res.end(JSON.stringify({ status: "ok", ocr: "test-fixture" }));
  });
  await new Promise((resolve) => intelligence.listen(0, "127.0.0.1", resolve));
  const app = await createApp({
    dataDir: dir,
    serviceUrl: `http://127.0.0.1:${intelligence.address().port}`,
    startWorker: false,
    test: true,
  });
  t.after(async () => {
    await app.locals.close();
    await new Promise((r) => intelligence.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  return { app, dir, agent: request.agent(app) };
}
const registration = (email) => ({
  name: "Priya Sharma",
  email,
  password: "correct-horse-042",
  patientName: "Ananya Sharma",
  surgery: "Knee surgery",
  timeZone: "Asia/Kolkata",
});
const medication = () => ({
  name: "MED-A",
  strength: "10 mg",
  dose: "1 tablet",
  instructions: "Fictional prescription",
  times: ["08:00"],
  startDate: dateInZone(new Date(), "Asia/Kolkata"),
  durationDays: 5,
  color: "purple",
  reviewed: true,
});

test("registration encrypts health records and authenticates account sessions", async (t) => {
  const { app, agent, dir } = await setup(t);
  await agent.get("/api/state").expect(401);
  const registered = await agent
    .post("/api/auth/register")
    .send(registration("caregiver@example.test"))
    .expect(201);
  assert.equal(registered.body.user.role, "caregiver");
  assert.ok(!registered.body.user.passwordHash);
  const med = await agent
    .post("/api/medications")
    .send(medication())
    .expect(201);
  const state = await agent.get("/api/state").expect(200);
  assert.equal(state.body.medications[0].name, "MED-A");
  assert.equal(state.body.risk.level, "low");
  assert.equal(
    state.body.doses.filter((d) => d.medicationId === med.body.id).length,
    5,
  );
  assert.ok(
    state.body.auditLog.some((a) => a.action === "medication.confirmed"),
  );
  const db = await readFile(path.join(dir, "recovertrack.sqlite-wal"));
  assert.ok(!db.includes(Buffer.from("Ananya Sharma")));
  assert.ok(!db.includes(Buffer.from("correct-horse-042")));
  assert.ok(!db.includes(Buffer.from("Knee surgery")));
  await agent.post("/api/auth/logout").send({}).expect(200);
  await agent.get("/api/state").expect(401);
  await agent
    .post("/api/auth/login")
    .send({ email: "CAREGIVER@example.test", password: "bad password" })
    .expect(401);
  await agent
    .post("/api/auth/login")
    .send({ email: "CAREGIVER@example.test", password: "correct-horse-042" })
    .expect(200);
  const duplicate = await request(app)
    .post("/api/auth/register")
    .send(registration("caregiver@example.test"));
  assert.equal(duplicate.status, 409);
});

test("mandatory review, invalid dates, duplicate dose times and future checkins are rejected", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("review@example.test"))
    .expect(201);
  await agent
    .post("/api/medications")
    .send({ ...medication(), reviewed: false })
    .expect(400);
  await agent
    .post("/api/medications")
    .send({ ...medication(), startDate: "2026-02-30" })
    .expect(400);
  await agent
    .post("/api/medications")
    .send({ ...medication(), times: ["08:00", "08:00"] })
    .expect(400);
  const med = await agent
    .post("/api/medications")
    .send({ ...medication(), startDate: addDays(medication().startDate, 1) })
    .expect(201);
  const state = await agent.get("/api/state").expect(200);
  const future = state.body.doses.find((d) => d.medicationId === med.body.id);
  await agent
    .post(`/api/doses/${future.id}/check-in`)
    .send({ status: "taken" })
    .expect(400);
});

test("household isolation, role permissions and concurrent check-in deduplication", async (t) => {
  const { app, agent } = await setup(t);
  const other = request.agent(app);
  await agent.post("/api/auth/demo").send({ role: "caregiver" }).expect(201);
  await other.post("/api/auth/demo").send({ role: "patient" }).expect(201);
  const a = (await agent.get("/api/state")).body;
  const b = (await other.get("/api/state")).body;
  assert.notEqual(a.patient.id, b.patient.id);
  const unrecorded = a.doses.find((d) => d.status === "missed");
  assert.ok(unrecorded);
  await other
    .post(`/api/doses/${unrecorded.id}/check-in`)
    .send({ status: "taken" })
    .expect(404);
  await other.post("/api/medications").send(medication()).expect(403);
  const results = await Promise.all([
    agent
      .post(`/api/doses/${unrecorded.id}/check-in`)
      .send({ status: "taken" }),
    agent
      .post(`/api/doses/${unrecorded.id}/check-in`)
      .send({ status: "taken" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  await agent.post(`/api/doses/${unrecorded.id}/undo`).send({}).expect(200);
  await agent.post(`/api/doses/${unrecorded.id}/undo`).send({}).expect(409);
});

test("pausing/removing medications preserves historical dose records", async (t) => {
  const { agent } = await setup(t);
  await agent.post("/api/auth/demo").send({}).expect(201);
  const before = (await agent.get("/api/state")).body;
  const med = before.medications[0];
  const historical = before.doses.filter(
    (d) => d.medicationId === med.id && Date.parse(d.scheduledAt) <= Date.now(),
  );
  await agent
    .patch(`/api/medications/${med.id}`)
    .send({ status: "paused" })
    .expect(200);
  const paused = (await agent.get("/api/state")).body;
  assert.equal(
    paused.doses.filter((d) => d.medicationId === med.id).length,
    historical.length,
  );
  await agent.delete(`/api/medications/${med.id}`).expect(200);
  const removed = (await agent.get("/api/state")).body;
  assert.ok(!removed.medications.some((m) => m.id === med.id));
  assert.equal(
    removed.doses.filter((d) => d.medicationId === med.id).length,
    historical.length,
  );
});

test("daily check-in upserts by patient-local day and validates self-reports", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("symptoms@example.test"))
    .expect(201);
  const initial = await agent
    .post("/api/checkins")
    .send({ pain: 4, mobility: "assisted", note: "Resting today." })
    .expect(201);
  const updated = await agent
    .post("/api/checkins")
    .send({
      pain: 2,
      mobility: "independent",
      note: "Feeling more comfortable.",
    })
    .expect(200);
  assert.equal(updated.body.id, initial.body.id);
  const state = await agent.get("/api/state");
  assert.equal(state.body.checkIns.length, 1);
  assert.equal(state.body.checkIns[0].pain, 2);
  await agent
    .post("/api/checkins")
    .send({ pain: 11, mobility: "independent" })
    .expect(400);
});

test("OCR creates only a draft; confirmation requires review and is single-use", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("ocr@example.test"))
    .expect(201);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  const draft = await agent
    .post("/api/prescriptions/upload")
    .attach("file", png, "prescription.png")
    .expect(201);
  assert.equal(draft.body.engine, "test-fixture");
  assert.equal(draft.body.criticalityFlag, true);
  assert.equal((await agent.get("/api/state")).body.medications.length, 0);
  await agent
    .post(`/api/prescriptions/${draft.body.id}/confirm`)
    .send({ medications: [{ ...medication(), reviewed: false }] })
    .expect(400);
  const confirms = await Promise.all([
    agent
      .post(`/api/prescriptions/${draft.body.id}/confirm`)
      .send({ medications: [medication()] }),
    agent
      .post(`/api/prescriptions/${draft.body.id}/confirm`)
      .send({ medications: [medication()] }),
  ]);
  assert.deepEqual(confirms.map((r) => r.status).sort(), [201, 409]);
  const state = (await agent.get("/api/state")).body;
  assert.equal(state.medications.length, 1);
  assert.equal(state.prescriptions[0].status, "confirmed");
  assert.ok(!state.prescriptions[0].text);
});

test("care-team invitation is email bound, single use, and clinician consent is enforced", async (t) => {
  const { app, agent } = await setup(t);
  const doctor = request.agent(app);
  const stranger = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send(registration("owner@example.test"))
    .expect(201);
  await doctor
    .post("/api/auth/register")
    .send(registration("doctor@example.test"))
    .expect(201);
  await stranger
    .post("/api/auth/register")
    .send(registration("stranger@example.test"))
    .expect(201);
  await agent
    .post("/api/care-team/invitations")
    .send({ role: "doctor", email: "doctor@example.test" })
    .expect(409);
  await agent.patch("/api/consent").send({ clinician: true }).expect(200);
  const invitation = await agent
    .post("/api/care-team/invitations")
    .send({ role: "doctor", email: "doctor@example.test" })
    .expect(201);
  await stranger
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(403);
  await doctor
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(200);
  assert.equal((await doctor.get("/api/state")).body.user.role, "doctor");
  await doctor.post("/api/medications").send(medication()).expect(403);
  await doctor
    .post("/api/checkins")
    .send({ pain: 1, mobility: "independent" })
    .expect(403);
  await stranger
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(400);
  await agent.patch("/api/consent").send({ clinician: false }).expect(200);
  await doctor.get("/api/state").expect(403);
});

test("CSRF cross-origin writes are denied and CSV output escapes spreadsheet formulas", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("csv@example.test"))
    .expect(201);
  await agent
    .post("/api/medications")
    .set("Origin", "https://evil.example")
    .send(medication())
    .expect(403);
  await agent
    .post("/api/medications")
    .send({ ...medication(), name: "=2+2" })
    .expect(201);
  const csv = await agent.get("/api/export").expect(200);
  assert.match(csv.text, /'\=2\+2/);
});

test("time-zone scheduling preserves local times and rejects nonexistent DST times", () => {
  assert.equal(
    localDateTimeToUTC("2026-10-23", "08:00", "Asia/Kolkata"),
    "2026-10-23T02:30:00.000Z",
  );
  assert.equal(
    localDateTimeToUTC("2026-03-07", "08:00", "America/New_York"),
    "2026-03-07T13:00:00.000Z",
  );
  assert.equal(
    localDateTimeToUTC("2026-03-08", "08:00", "America/New_York"),
    "2026-03-08T12:00:00.000Z",
  );
  assert.throws(
    () => localDateTimeToUTC("2026-03-08", "02:30", "America/New_York"),
    /does not exist/,
  );
  const doses = generateDoses(
    {
      id: "test",
      householdId: "a",
      name: "MED-A",
      times: ["08:00", "20:00"],
      startDate: "2026-03-07",
      durationDays: 3,
    },
    "America/New_York",
  );
  assert.equal(doses.length, 6);
  assert.equal(new Set(doses.map((d) => d.id)).size, 6);
});

test("revoked caregiver sharing blocks existing members and session metadata", async (t) => {
  const { app, agent } = await setup(t);
  const member = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send(registration("share-owner@example.test"))
    .expect(201);
  await member
    .post("/api/auth/register")
    .send(registration("family@example.test"))
    .expect(201);
  const invitation = await agent
    .post("/api/care-team/invitations")
    .send({ role: "caregiver" })
    .expect(201);
  await member
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(200);
  await member.get("/api/state").expect(200);
  await agent.patch("/api/consent").send({ caregiver: false }).expect(200);
  await member.get("/api/state").expect(403);
  await member.get("/api/auth/me").expect(403);
  await agent.get("/api/state").expect(200);
  await agent.patch("/api/consent").send({ app: false }).expect(200);
  await agent.post("/api/medications").send(medication()).expect(403);
  const paused = await agent.get("/api/state").expect(200);
  assert.equal(paused.body.risk.level, "unavailable");
  await agent.patch("/api/consent").send({ app: true }).expect(200);
  await agent.post("/api/medications").send(medication()).expect(201);
});

test("prescription business-rule validation is all-or-nothing before medication writes", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("atomic@example.test"))
    .expect(201);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  const draft = await agent
    .post("/api/prescriptions/upload")
    .attach("file", png, "prescription.png")
    .expect(201);
  await agent
    .post(`/api/prescriptions/${draft.body.id}/confirm`)
    .send({
      medications: [
        medication(),
        { ...medication(), name: "MED-B", startDate: "2000-01-01" },
      ],
    })
    .expect(400);
  const state = (await agent.get("/api/state")).body;
  assert.equal(state.medications.length, 0);
  assert.equal(state.prescriptions[0].status, "draft");
});

test("callback creation deduplicates concurrent reads and remains resolved for the local day", async (t) => {
  const { agent } = await setup(t, { ...risk, level: "high", score: 82 });
  await agent.post("/api/auth/demo").send({ role: "doctor" }).expect(201);
  const concurrent = await Promise.all([
    agent.get("/api/state"),
    agent.get("/api/state"),
    agent.get("/api/state"),
  ]);
  concurrent.forEach((r) => assert.equal(r.status, 200));
  const state = (await agent.get("/api/state")).body;
  assert.equal(state.callbacks.length, 1);
  await agent
    .post(`/api/callbacks/${state.callbacks[0].id}/resolve`)
    .send({ note: "Reviewed the record." })
    .expect(200);
  const after = (await agent.get("/api/state")).body;
  assert.equal(after.callbacks.length, 1);
  assert.equal(after.callbacks[0].status, "resolved");
});

test("status-only medication edits preserve reviewed clinical fields", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("patch@example.test"))
    .expect(201);
  const created = await agent
    .post("/api/medications")
    .send({
      ...medication(),
      color: "green",
      instructions: "Keep these original instructions.",
    })
    .expect(201);
  const updated = await agent
    .patch(`/api/medications/${created.body.id}`)
    .send({ status: "paused" })
    .expect(200);
  assert.equal(updated.body.color, "green");
  assert.equal(updated.body.instructions, "Keep these original instructions.");
});

test("starting a new session invalidates the previous token", async (t) => {
  const { app, agent } = await setup(t);
  const old = await agent.post("/api/auth/demo").send({}).expect(201);
  const oldCookie = old.headers["set-cookie"][0].split(";")[0];
  await agent.post("/api/auth/demo").send({ role: "patient" }).expect(201);
  await request(app).get("/api/state").set("Cookie", oldCookie).expect(401);
});

test("manual multi-medication batch validates all records before any schedules are created", async (t) => {
  const { agent } = await setup(t);
  await agent
    .post("/api/auth/register")
    .send(registration("batch@example.test"))
    .expect(201);
  await agent
    .post("/api/medications/batch")
    .send({
      medications: [
        medication(),
        { ...medication(), name: "MED-B", startDate: "2000-01-01" },
      ],
    })
    .expect(400);
  assert.equal((await agent.get("/api/state")).body.medications.length, 0);
  const saved = await agent
    .post("/api/medications/batch")
    .send({
      medications: [
        medication(),
        { ...medication(), name: "MED-B", color: "green" },
      ],
    })
    .expect(201);
  assert.equal(saved.body.medications.length, 2);
  assert.equal((await agent.get("/api/state")).body.medications.length, 2);
});

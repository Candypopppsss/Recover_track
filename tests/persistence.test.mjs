import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import { dateInZone } from "../server/scheduling.mjs";

test("encrypted household records and sessions survive an API restart with the retained local key", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "recovertrack-restart-"));
  let app = await createApp({
    postgresUri: null,
    mongoUri: null,
    dataDir,
    startWorker: false,
    test: true,
    serviceUrl: "http://127.0.0.1:1",
  });
  t.after(async () => {
    if (app) await app.locals.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const registered = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Fictional Caregiver",
      patientName: "Fictional Patient",
      email: "restart@example.test",
      password: "Fictional-restart-passphrase",
      timeZone: "Asia/Kolkata",
    })
    .expect(201);
  const cookie = registered.headers["set-cookie"][0].split(";")[0];
  const medication = await request(app)
    .post("/api/medications")
    .set("Cookie", cookie)
    .send({
      name: "MED-RESTART",
      strength: "10 mg",
      dose: "1 tablet",
      instructions: "Fictional test card",
      times: ["08:00"],
      startDate: dateInZone(new Date(), "Asia/Kolkata"),
      durationDays: 3,
      color: "purple",
      reviewed: true,
    })
    .expect(201);
  await app.locals.close();
  app = null;
  const keyInfo = await stat(path.join(dataDir, "encryption.key"));
  assert.equal(keyInfo.mode & 0o777, 0o600);
  app = await createApp({
    postgresUri: null,
    mongoUri: null,
    dataDir,
    startWorker: false,
    test: true,
    serviceUrl: "http://127.0.0.1:1",
  });
  const restored = await request(app)
    .get("/api/state")
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(restored.body.user.id, registered.body.user.id);
  assert.equal(restored.body.patient.name, "Fictional Patient");
  assert.equal(restored.body.medications[0].id, medication.body.id);
  assert.equal(
    restored.body.doses.filter((d) => d.medicationId === medication.body.id)
      .length,
    3,
  );
  assert.equal(restored.body.risk.level, "unavailable");
});

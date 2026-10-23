import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { MongoClient } from "mongodb";
import { createVercelApp, createVercelHandler } from "../../server/vercel.mjs";
import { dateInZone } from "../../server/scheduling.mjs";

const mongoUri = process.env.RECOVERTRACK_TEST_MONGODB_URI;
if (!mongoUri) throw new Error("Set RECOVERTRACK_TEST_MONGODB_URI to a disposable MongoDB server before running test:mongo.");

test("Vercel handler runs real OCR and restores encrypted records in a fresh function instance", { timeout: 60_000 }, async (t) => {
  const names = ["MONGODB_URI", "MONGODB_DATABASE", "DATA_ENCRYPTION_KEY", "COOKIE_SECURE", "TRUST_PROXY"];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const database = "recovertrack_vercel_" + randomUUID().replaceAll("-", "");
  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DATABASE = database;
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const raw = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
  const apps = [];
  t.after(async () => {
    try {
      await Promise.all(apps.map((app) => app.locals.close()));
      await raw.db(database).dropDatabase();
    } finally {
      await raw.close();
      for (const name of names) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
    }
  });
  await raw.connect();
  const instance = () => createVercelHandler(async () => {
    const app = await createVercelApp();
    apps.push(app);
    return app;
  });
  const first = instance();
  const headers = (call) => call.set("Host", "recovertrack-test.vercel.app").set("X-Forwarded-Proto", "https");
  const health = await headers(request(first).get("/api/health")).expect(200);
  assert.equal(health.body.database, "mongodb");
  assert.match(health.body.ocr, /tesseract/i);
  await headers(request(first).get("/api/state")).expect(401);
  const registered = await headers(request(first).post("/api/auth/register")).send({
    name: "Fictional caregiver", email: "vercel-workflow@integration.test", password: "fictional-workflow-passphrase",
    patientName: "Fictional recovery patient", surgery: "Fictional recovery", timeZone: "Asia/Kolkata",
  }).expect(201);
  const cookieHeader = registered.headers["set-cookie"][0];
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  const cookie = cookieHeader.split(";")[0];
  const authorized = (call) => headers(call).set("Cookie", cookie);
  const extracted = await authorized(request(first).post("/api/prescriptions/upload"))
    .attach("file", new URL("../fixtures/prescription-test.png", import.meta.url).pathname).expect(201);
  assert.match(extracted.body.text, /MED-A/i);
  assert.match(extracted.body.engine, /tesseract/i);
  assert.ok(extracted.body.medications.length > 0);
  assert.equal((await authorized(request(first).get("/api/state")).expect(200)).body.medications.length, 0);
  const reviewed = {
    name: "MED-A", strength: "10 mg", dose: "1 tablet", instructions: "Fictional reviewed instructions",
    times: ["08:00"], startDate: dateInZone(new Date(), "Asia/Kolkata"), durationDays: 5,
    color: "purple", reviewed: true,
  };
  await authorized(request(first).post(`/api/prescriptions/${extracted.body.id}/confirm`))
    .send({ medications: [{ ...reviewed, reviewed: false }] }).expect(400);
  await authorized(request(first).post(`/api/prescriptions/${extracted.body.id}/confirm`))
    .send({ medications: [reviewed] }).expect(201);
  await authorized(request(first).post("/api/checkins")).set("Origin", "https://foreign.test")
    .send({ pain: 2, mobility: "assisted", note: "Fictional check-in" }).expect(403);
  await authorized(request(first).post("/api/checkins")).set("Origin", "https://recovertrack-test.vercel.app")
    .send({ pain: 2, mobility: "assisted", note: "Fictional check-in" }).expect(201);
  const second = instance();
  const restored = (await authorized(request(second).get("/api/state")).expect(200)).body;
  assert.equal(restored.user.email, "vercel-workflow@integration.test");
  assert.equal(restored.medications[0].name, "MED-A");
  assert.equal(restored.doses.length, 5);
  assert.equal(restored.checkIns.length, 1);
  assert.equal(restored.prescriptions[0].status, "confirmed");
  const persisted = JSON.stringify(await raw.db(database).collection("records").find({}).toArray());
  for (const sensitive of ["Fictional recovery patient", "fictional-workflow-passphrase", "Fictional check-in", "MED-A"]) assert.ok(!persisted.includes(sensitive));
});

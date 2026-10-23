import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { MongoClient } from "mongodb";
import { createApp } from "../../server/app.mjs";
import { createStore } from "../../server/store.mjs";
import { addDays, dateInZone } from "../../server/scheduling.mjs";

// This suite is deliberately separate from the normal SQLite test run.
const mongoUri = process.env.RECOVERTRACK_TEST_MONGODB_URI;
if (!mongoUri) {
  throw new Error(
    "Set RECOVERTRACK_TEST_MONGODB_URI to a disposable MongoDB server before running test:mongo.",
  );
}

const fixture = {
  text: "MED-A 10 mg 1 tablet 08:00 for 5 days",
  engine: "storage-integration-fixture",
  medications: [
    {
      name: "MED-A",
      strength: "10 mg",
      dose: "1 tablet",
      times: ["08:00"],
      durationDays: 5,
    },
  ],
};
const prescription = () => ({
  name: "MED-A",
  strength: "10 mg",
  dose: "1 tablet",
  instructions: "Fictional storage integration case",
  times: ["08:00"],
  startDate: dateInZone(new Date(), "Asia/Kolkata"),
  durationDays: 5,
  color: "purple",
  reviewed: true,
});
const account = (label) => ({
  name: "Fictional caregiver",
  email: label + "@integration.test",
  password: "fictional-account-passphrase",
  patientName: "Fictional recovery patient",
  surgery: "Fictional recovery",
  timeZone: "Asia/Kolkata",
});

async function setup(t) {
  const database =
    "recovertrack_integration_" + randomUUID().replaceAll("-", "");
  const dir = await mkdtemp(path.join(tmpdir(), "recovertrack-mongo-"));
  const originalDatabase = process.env.MONGODB_DATABASE;
  const originalKey = process.env.DATA_ENCRYPTION_KEY;
  process.env.MONGODB_DATABASE = database;
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const raw = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 8000 });
  let app;
  const peers = new Set();
  const intelligence = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/ocr") {
      for await (const _chunk of req) {
        /* drain the synthetic upload */
      }
      res.end(JSON.stringify(fixture));
    } else if (req.url === "/risk") {
      for await (const _chunk of req) {
        /* storage tests do not test attention rules */
      }
      res.end(
        JSON.stringify({
          score: null,
          level: "unavailable",
          explanation: ["Storage integration fixture."],
          experimental: true,
          modelVersion: "storage-fixture",
        }),
      );
    } else
      res.end(
        JSON.stringify({ status: "ok", ocr: "storage-integration-fixture" }),
      );
  });
  t.after(async () => {
    const failures = [];
    for (const clean of [
      () => app?.locals.close(),
      ...[...peers].map((peer) => () => peer.locals.close()),
      () => new Promise((resolve) => intelligence.close(resolve)),
      () => raw.db(database).dropDatabase(),
      () => raw.close(),
      () => rm(dir, { recursive: true, force: true }),
    ]) {
      try {
        await clean();
      } catch (error) {
        failures.push(error);
      }
    }
    if (originalDatabase === undefined) delete process.env.MONGODB_DATABASE;
    else process.env.MONGODB_DATABASE = originalDatabase;
    if (originalKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = originalKey;
    if (failures.length)
      throw new AggregateError(failures, "MongoDB integration cleanup failed.");
  });
  await raw.connect();
  await new Promise((resolve) => intelligence.listen(0, "127.0.0.1", resolve));
  const options = {
    mongoUri,
    postgresUri: null,
    dataDir: dir,
    serviceUrl: `http://127.0.0.1:${intelligence.address().port}`,
    startWorker: false,
    test: true,
  };
  app = await createApp(options);
  return {
    get app() {
      return app;
    },
    dir,
    raw: raw.db(database).collection("records"),
    leases: raw.db(database).collection("record_locks"),
    async createPeer() {
      const peer = await createApp(options);
      peers.add(peer);
      return peer;
    },
    async restartWithoutLocalData() {
      await app.locals.close();
      app = null;
      await rm(dir, { recursive: true, force: true });
      app = await createApp(options);
      return app;
    },
  };
}

async function draft(agent) {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  return (
    await agent
      .post("/api/prescriptions/upload")
      .attach("file", png, "fictional.png")
      .expect(201)
  ).body;
}

test("MongoDB adapter encrypts CRUD payloads and scopes household lists", async (t) => {
  const ctx = await setup(t),
    store = ctx.app.locals.store;
  assert.equal(store.kind, "mongodb");
  await store.put(
    "verification",
    "a",
    { privateNote: "Fictional private note A" },
    "household-a",
  );
  await store.put(
    "verification",
    "b",
    { privateNote: "Fictional private note B" },
    "household-b",
  );
  assert.deepEqual(await store.list("verification", "household-a"), [
    { privateNote: "Fictional private note A" },
  ]);
  const record = await ctx.raw.findOne({ _id: "verification:a" });
  assert.deepEqual(Object.keys(record).sort(), [
    "_id",
    "household",
    "kind",
    "payload",
  ]);
  assert.equal(typeof record.payload, "string");
  assert.ok(!JSON.stringify(record).includes("Fictional private note"));
  await store.put(
    "verification",
    "a",
    { privateNote: "Updated fictional note" },
    "household-a",
  );
  assert.equal(
    (await store.get("verification", "a")).privateNote,
    "Updated fictional note",
  );
  await store.delete("verification", "a");
  assert.equal(await store.get("verification", "a"), null);
  assert.equal((await store.list("verification", "household-b")).length, 1);
  await assert.rejects(
    store.exclusive("fictional-error-path", async () => {
      throw new Error("Fictional update failed");
    }),
    /Fictional update failed/,
  );
  assert.equal(
    await ctx.leases.countDocuments({}),
    0,
    "failed updates release their own lease",
  );
  assert.deepEqual(await readdir(ctx.dir), []);
});

test("MongoDB preserves account, session, confirmed prescription and doses after all local data is discarded", async (t) => {
  const ctx = await setup(t),
    agent = request.agent(ctx.app);
  const registered = await agent
    .post("/api/auth/register")
    .send(account("persistence"))
    .expect(201);
  const cookie = registered.headers["set-cookie"]
    .map((value) => value.split(";")[0])
    .join("; ");
  const extracted = await draft(agent);
  await agent
    .post(`/api/prescriptions/${extracted.id}/confirm`)
    .send({ medications: [{ ...prescription(), reviewed: false }] })
    .expect(400);
  const confirmed = await agent
    .post(`/api/prescriptions/${extracted.id}/confirm`)
    .send({ medications: [prescription()] })
    .expect(201);
  const medicationId = confirmed.body.medications[0].id;
  await agent
    .post("/api/checkins")
    .send({ pain: 2, mobility: "assisted", note: "Fictional daily check-in" })
    .expect(201);
  assert.deepEqual(await readdir(ctx.dir), []); // No local key/database/upload required.
  const saved = await ctx.app.locals.store.get("prescription", extracted.id);
  assert.equal(saved.status, "confirmed");
  assert.equal("text" in saved, false);
  assert.equal("medications" in saved, false);
  const rawRecords = JSON.stringify(await ctx.raw.find({}).toArray());
  for (const text of [
    "Fictional recovery patient",
    "fictional-account-passphrase",
    "Fictional daily check-in",
  ])
    assert.ok(!rawRecords.includes(text));
  const app = await ctx.restartWithoutLocalData();
  const restored = (
    await request(app).get("/api/state").set("Cookie", cookie).expect(200)
  ).body;
  assert.equal(restored.user.email, "persistence@integration.test");
  assert.equal(restored.medications[0].id, medicationId);
  assert.equal(
    restored.doses.filter((dose) => dose.medicationId === medicationId).length,
    5,
  );
  assert.equal(restored.prescriptions[0].status, "confirmed");
  assert.equal(restored.checkIns.length, 1);
  await assert.rejects(readdir(ctx.dir), { code: "ENOENT" });
  await request(app)
    .post("/api/auth/login")
    .send({
      email: "persistence@integration.test",
      password: account("persistence").password,
    })
    .expect(200);
});

test("MongoDB-backed API enforces household ownership and patient/doctor write restrictions", async (t) => {
  const ctx = await setup(t),
    owner = request.agent(ctx.app),
    other = request.agent(ctx.app),
    patient = request.agent(ctx.app),
    doctor = request.agent(ctx.app);
  await owner.post("/api/auth/demo").send({ role: "caregiver" }).expect(201);
  await other.post("/api/auth/demo").send({ role: "caregiver" }).expect(201);
  await patient.post("/api/auth/demo").send({ role: "patient" }).expect(201);
  await doctor.post("/api/auth/demo").send({ role: "doctor" }).expect(201);
  const state = (await owner.get("/api/state").expect(200)).body;
  const foreign = (await other.get("/api/state").expect(200)).body;
  assert.notEqual(state.patient.id, foreign.patient.id);
  await other
    .patch(`/api/medications/${state.medications[0].id}`)
    .send({ status: "paused" })
    .expect(404);
  await patient.post("/api/medications").send(prescription()).expect(403);
  await doctor.post("/api/medications").send(prescription()).expect(403);
  await request(ctx.app).get("/api/state").expect(401);
});

test("MongoDB sharing honors email-bound invitations and immediate clinician consent revocation", async (t) => {
  const ctx = await setup(t),
    owner = request.agent(ctx.app),
    clinician = request.agent(await ctx.createPeer()),
    stranger = request.agent(ctx.app);
  await stranger
    .post("/api/auth/register")
    .send(account("stranger"))
    .expect(201);
  await owner.post("/api/auth/register").send(account("owner")).expect(201);
  await clinician
    .post("/api/auth/register")
    .send(account("clinician"))
    .expect(201);
  await owner.patch("/api/consent").send({ clinician: true }).expect(200);
  const invitation = await owner
    .post("/api/care-team/invitations")
    .send({ role: "doctor", email: "clinician@integration.test" })
    .expect(201);
  await stranger
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(403);
  await clinician
    .post("/api/care-team/join")
    .send({ code: invitation.body.code })
    .expect(200);
  const shared = (await clinician.get("/api/state").expect(200)).body;
  assert.equal(shared.user.role, "doctor");
  assert.equal(shared.patient.name, "Fictional recovery patient");
  await clinician.post("/api/medications").send(prescription()).expect(403);
  await owner.patch("/api/consent").send({ clinician: false }).expect(200);
  await clinician.get("/api/state").expect(403);
  await clinician.get("/api/export").expect(403);
});

test("MongoDB-backed concurrent dose check-ins persist one result", async (t) => {
  const ctx = await setup(t),
    agent = request.agent(ctx.app);
  await agent.post("/api/auth/demo").send({ role: "caregiver" }).expect(201);
  const state = (await agent.get("/api/state").expect(200)).body;
  const dose = state.doses.find((item) => item.status === "missed");
  assert.ok(dose);
  const results = await Promise.all([
    agent.post(`/api/doses/${dose.id}/check-in`).send({ status: "taken" }),
    agent.post(`/api/doses/${dose.id}/check-in`).send({ status: "taken" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await ctx.raw.countDocuments({ _id: "dose:" + dose.id }), 1);
  assert.equal(
    (await ctx.app.locals.store.get("dose", dose.id)).status,
    "taken",
  );
});

test("MongoDB-backed concurrent prescription confirmations activate one regimen", async (t) => {
  const ctx = await setup(t),
    agent = request.agent(ctx.app);
  await agent
    .post("/api/auth/register")
    .send(account("concurrent"))
    .expect(201);
  const extracted = await draft(agent);
  const results = await Promise.all([
    agent
      .post(`/api/prescriptions/${extracted.id}/confirm`)
      .send({ medications: [prescription()] }),
    agent
      .post(`/api/prescriptions/${extracted.id}/confirm`)
      .send({ medications: [prescription()] }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const state = (await agent.get("/api/state").expect(200)).body;
  assert.equal(state.medications.length, 1);
  assert.equal(state.doses.length, 5);
  assert.equal(await ctx.raw.countDocuments({ kind: "medication" }), 1);
});

test("MongoDB ciphertext needs the same external encryption key after ephemeral restart", async (t) => {
  const ctx = await setup(t),
    originalKey = process.env.DATA_ENCRYPTION_KEY;
  await ctx.app.locals.store.put(
    "verification",
    "key-test",
    { privateNote: "Fictional key continuity case" },
    "household-a",
  );
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  let wrong;
  try {
    wrong = await createStore({
      mongoUri,
      postgresUri: null,
      dataDir: ctx.dir,
    });
    await assert.rejects(wrong.get("verification", "key-test"));
  } finally {
    await wrong?.close();
    process.env.DATA_ENCRYPTION_KEY = originalKey;
  }
  const app = await ctx.restartWithoutLocalData();
  assert.equal(
    (await app.locals.store.get("verification", "key-test")).privateNote,
    "Fictional key continuity case",
  );
  await assert.rejects(readdir(ctx.dir), { code: "ENOENT" });
});

test("MongoDB serializes same-email registration across separate API instances", async (t) => {
  const ctx = await setup(t),
    peer = await ctx.createPeer();
  const results = await Promise.all([
    request(ctx.app)
      .post("/api/auth/register")
      .send(account("distributed-registration")),
    request(peer)
      .post("/api/auth/register")
      .send(account("distributed-registration")),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const users = await ctx.app.locals.store.list("user");
  assert.equal(
    users.filter(
      (user) => user.email === "distributed-registration@integration.test",
    ).length,
    1,
  );
  assert.equal(await ctx.raw.countDocuments({ kind: "patient" }), 1);
  assert.equal(
    await ctx.leases.countDocuments({}),
    0,
    "responses are sent after releasing Mongo leases",
  );
});

test("MongoDB serializes prescription confirmation and dose check-in across API instances", async (t) => {
  const ctx = await setup(t),
    peer = await ctx.createPeer(),
    agent = request.agent(ctx.app);
  const registered = await agent
    .post("/api/auth/register")
    .send(account("distributed-regimen"))
    .expect(201);
  const cookie = registered.headers["set-cookie"]
    .map((value) => value.split(";")[0])
    .join("; ");
  const extracted = await draft(agent);
  const reviewed = {
    ...prescription(),
    startDate: addDays(dateInZone(new Date(), "Asia/Kolkata"), -1),
  };
  const confirmations = await Promise.all(
    [ctx.app, peer].map((app) =>
      request(app)
        .post(`/api/prescriptions/${extracted.id}/confirm`)
        .set("Cookie", cookie)
        .send({ medications: [reviewed] }),
    ),
  );
  assert.deepEqual(
    confirmations.map((result) => result.status).sort(),
    [201, 409],
  );
  const state = (await agent.get("/api/state").expect(200)).body;
  assert.equal(state.medications.length, 1);
  assert.equal(state.doses.length, 5);
  const dose = state.doses.find((item) => item.status === "missed");
  assert.ok(dose, "yesterday's dose is available for a check-in");
  const checkIns = await Promise.all(
    [ctx.app, peer].map((app) =>
      request(app)
        .post(`/api/doses/${dose.id}/check-in`)
        .set("Cookie", cookie)
        .send({ status: "taken" }),
    ),
  );
  assert.deepEqual(checkIns.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    (await ctx.app.locals.store.get("dose", dose.id)).status,
    "taken",
  );
  assert.equal(await ctx.raw.countDocuments({ kind: "medication" }), 1);
  assert.equal(await ctx.raw.countDocuments({ kind: "dose" }), 5);
  assert.equal(await ctx.leases.countDocuments({}), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import request from "supertest";
import { createApp } from "../../server/app.mjs";
import { createStore } from "../../server/store.mjs";
import { createVercelApp, createVercelHandler } from "../../server/vercel.mjs";
import { addDays, dateInZone } from "../../server/scheduling.mjs";

// This opt-in suite needs a disposable PostgreSQL server with CREATEDB rights.
const postgresUri = process.env.RECOVERTRACK_TEST_POSTGRES_URL;
if (!postgresUri) {
  throw new Error(
    "Set RECOVERTRACK_TEST_POSTGRES_URL to a disposable PostgreSQL server before running test:postgres.",
  );
}

const account = (label) => ({
  name: "Fictional caregiver",
  email: label + "@integration.test",
  password: "fictional-account-passphrase",
  patientName: "Fictional recovery patient",
  surgery: "Fictional recovery",
  timeZone: "Asia/Kolkata",
});
const prescription = () => ({
  name: "MED-A",
  strength: "10 mg",
  dose: "1 tablet",
  instructions: "Fictional reviewed prescription",
  times: ["08:00"],
  startDate: dateInZone(new Date(), "Asia/Kolkata"),
  durationDays: 5,
  color: "purple",
  reviewed: true,
});
const fakeIntelligence = async (url) => {
  const endpoint = new URL(url).pathname;
  if (endpoint === "/ocr")
    return Response.json({
      text: "MED-A 10 mg 1 tablet 08:00 for 5 days",
      engine: "postgres-storage-fixture",
      medications: [
        {
          name: "MED-A",
          strength: "10 mg",
          dose: "1 tablet",
          times: ["08:00"],
          durationDays: 5,
        },
      ],
    });
  if (endpoint === "/risk")
    return Response.json({
      score: null,
      level: "unavailable",
      experimental: true,
      explanation: ["Storage integration fixture."],
      modelVersion: "storage-fixture",
    });
  return Response.json({ status: "ok", ocr: "postgres-storage-fixture" });
};

async function setup(t, { concurrentColdStart = false } = {}) {
  const database = "recovertrack_pg_" + randomUUID().replaceAll("-", "");
  const names = [
    "DATA_ENCRYPTION_KEY",
    "DATABASE_URL",
    "POSTGRES_URL",
    "MONGODB_URI",
    "COOKIE_SECURE",
    "TRUST_PROXY",
    "DATA_DIR",
  ];
  const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const dir = await mkdtemp(path.join(tmpdir(), "recovertrack-postgres-"));
  process.env.DATA_DIR = dir;
  const admin = new pg.Pool({
    connectionString: postgresUri,
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  const uri = new URL(postgresUri);
  uri.pathname = "/" + database;
  const raw = new pg.Pool({
    connectionString: uri.href,
    max: 3,
    connectionTimeoutMillis: 8000,
  });
  const apps = new Set();
  let app,
    databaseCreated = false;
  const dropDatabase = async () => {
    if (!databaseCreated) return;
    // Pool shutdown can finish before PostgreSQL observes the closed socket.
    // Wait for that bounded handshake instead of forcibly killing a connection.
    for (let attempt = 0; attempt < 80; attempt++) {
      const sessions = await admin.query(
        "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1",
        [database],
      );
      if (Number(sessions.rows[0].count) === 0) {
        await admin.query(`DROP DATABASE "${database}"`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      "PostgreSQL test connections did not close before cleanup.",
    );
  };
  t.after(async () => {
    const failures = [];
    for (const clean of [
      ...[...apps].map((instance) => () => instance.locals.close()),
      () => raw.end(),
      dropDatabase,
      () => admin.end(),
      () => rm(dir, { recursive: true, force: true }),
    ]) {
      try {
        await clean();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        "PostgreSQL integration cleanup failed.",
      );
  });
  // Database names are generated locally from hexadecimal UUIDs, never supplied by a user.
  await admin.query(`CREATE DATABASE "${database}"`);
  databaseCreated = true;
  const options = {
    postgresUri: uri.href,
    dataDir: dir,
    startWorker: false,
    serveStatic: false,
    test: true,
    intelligenceRequest: fakeIntelligence,
  };
  const create = async () => {
    const instance = await createApp(options);
    apps.add(instance);
    return instance;
  };
  if (concurrentColdStart) [app] = await Promise.all([create(), create()]);
  else app = await create();
  return {
    get app() {
      return app;
    },
    raw,
    dir,
    uri: uri.href,
    apps,
    createPeer: create,
    async restartWithoutLocalData() {
      await app.locals.close();
      apps.delete(app);
      app = null;
      await rm(dir, { recursive: true, force: true });
      app = await create();
      return app;
    },
    async count(kind) {
      return Number(
        (
          await raw.query(
            "SELECT count(*) AS count FROM recovertrack_records WHERE kind=$1",
            [kind],
          )
        ).rows[0].count,
      );
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
const cookieFrom = (response) =>
  response.headers["set-cookie"].map((value) => value.split(";")[0]).join("; ");

test("PostgreSQL initializes its schema and encrypts parameterized CRUD records with household isolation", async (t) => {
  const ctx = await setup(t, { concurrentColdStart: true }),
    store = ctx.app.locals.store;
  assert.equal(store.kind, "postgresql-encrypted");
  const quoted = "fictional'; DROP TABLE recovertrack_records; --";
  await store.put(
    "verification",
    quoted,
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
  const record = (
    await ctx.raw.query(
      "SELECT * FROM recovertrack_records WHERE kind=$1 AND id=$2",
      ["verification", quoted],
    )
  ).rows[0];
  assert.deepEqual(Object.keys(record).sort(), [
    "household",
    "id",
    "kind",
    "payload",
  ]);
  assert.equal(typeof record.payload, "string");
  assert.ok(!JSON.stringify(record).includes("Fictional private note"));
  await store.put(
    "verification",
    quoted,
    { privateNote: "Updated fictional note" },
    "household-a",
  );
  assert.equal(
    (await store.get("verification", quoted)).privateNote,
    "Updated fictional note",
  );
  await store.delete("verification", quoted);
  assert.equal(await store.get("verification", quoted), null);
  assert.equal((await store.list("verification", "household-b")).length, 1);
  assert.deepEqual(await readdir(ctx.dir), []);
});

test("PostgreSQL rolls back failed store, account and prescription updates while reusing the transaction for nested reads", async (t) => {
  t.mock.method(console, "error", () => {});
  const ctx = await setup(t),
    store = ctx.app.locals.store;
  await store.put(
    "verification",
    "original",
    { value: "before" },
    "household-a",
  );
  await assert.rejects(
    store.exclusive("household-a", async () => {
      await store.put(
        "verification",
        "original",
        { value: "changed" },
        "household-a",
      );
      await store.put(
        "verification",
        "new",
        { value: "new fictional record" },
        "household-a",
      );
      assert.equal(
        (await store.get("verification", "original")).value,
        "changed",
      );
      assert.equal((await store.list("verification", "household-a")).length, 2);
      throw new Error("Fictional all-or-nothing failure");
    }),
    /Fictional all-or-nothing failure/,
  );
  assert.equal((await store.get("verification", "original")).value, "before");
  assert.equal(await store.get("verification", "new"), null);
  await store.exclusive("household-a", async () => {
    await store.put(
      "verification",
      "committed",
      { value: "committed fictional record" },
      "household-a",
    );
  });
  assert.equal(
    (await store.get("verification", "committed")).value,
    "committed fictional record",
  );
  const locks = await ctx.raw.query(
    "SELECT count(*) AS count FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
  );
  assert.equal(
    Number(locks.rows[0].count),
    0,
    "both rollback and commit release their transaction locks",
  );
  const originalPut = store.put;
  store.put = async (kind, ...args) => {
    if (kind === "patient")
      throw new Error("Fictional registration storage interruption");
    return originalPut(kind, ...args);
  };
  try {
    await request(ctx.app)
      .post("/api/auth/register")
      .send(account("rollback-account"))
      .expect(500);
    for (const kind of ["user", "email", "patient", "session"])
      assert.equal(await ctx.count(kind), 0);
  } finally {
    store.put = originalPut;
  }
  const agent = request.agent(ctx.app);
  await agent
    .post("/api/auth/register")
    .send(account("rollback-account"))
    .expect(201);
  const extracted = await draft(agent);
  store.put = async (kind, ...args) => {
    if (kind === "dose")
      throw new Error("Fictional regimen storage interruption");
    return originalPut(kind, ...args);
  };
  try {
    await agent
      .post(`/api/prescriptions/${extracted.id}/confirm`)
      .send({ medications: [prescription()] })
      .expect(500);
    assert.equal(await ctx.count("medication"), 0);
    assert.equal(await ctx.count("dose"), 0);
    assert.equal(
      (await store.get("prescription", extracted.id)).status,
      "draft",
    );
  } finally {
    store.put = originalPut;
  }
  await agent
    .post(`/api/prescriptions/${extracted.id}/confirm`)
    .send({ medications: [prescription()] })
    .expect(201);
  assert.equal(await ctx.count("medication"), 1);
  assert.equal(await ctx.count("dose"), 5);
});

test("PostgreSQL preserves sessions, confirmed prescription and doses after an entirely fresh API and data directory", async (t) => {
  const ctx = await setup(t),
    agent = request.agent(ctx.app);
  const registered = await agent
    .post("/api/auth/register")
    .send(account("persistence"))
    .expect(201);
  const cookie = cookieFrom(registered);
  const extracted = await draft(agent);
  await agent
    .post(`/api/prescriptions/${extracted.id}/confirm`)
    .send({ medications: [{ ...prescription(), reviewed: false }] })
    .expect(400);
  const confirmed = await agent
    .post(`/api/prescriptions/${extracted.id}/confirm`)
    .send({ medications: [prescription()] })
    .expect(201);
  await agent
    .post("/api/checkins")
    .send({ pain: 2, mobility: "assisted", note: "Fictional daily check-in" })
    .expect(201);
  const saved = await ctx.app.locals.store.get("prescription", extracted.id);
  assert.equal(saved.status, "confirmed");
  assert.equal("text" in saved, false);
  assert.equal("medications" in saved, false);
  const rawRecords = JSON.stringify(
    (await ctx.raw.query("SELECT * FROM recovertrack_records")).rows,
  );
  for (const sensitive of [
    "Fictional recovery patient",
    "fictional-account-passphrase",
    "Fictional daily check-in",
    "MED-A",
  ])
    assert.ok(!rawRecords.includes(sensitive));
  const restarted = await ctx.restartWithoutLocalData();
  const restored = (
    await request(restarted).get("/api/state").set("Cookie", cookie).expect(200)
  ).body;
  assert.equal(restored.user.email, "persistence@integration.test");
  assert.equal(restored.medications[0].id, confirmed.body.medications[0].id);
  assert.equal(restored.doses.length, 5);
  assert.equal(restored.prescriptions[0].status, "confirmed");
  assert.equal(restored.checkIns.length, 1);
  await assert.rejects(readdir(ctx.dir), { code: "ENOENT" });
  await request(restarted)
    .post("/api/auth/login")
    .send({
      email: "persistence@integration.test",
      password: account("persistence").password,
    })
    .expect(200);
});

test("PostgreSQL-backed API rejects foreign household records and patient or clinician writes", async (t) => {
  const ctx = await setup(t),
    owner = request.agent(ctx.app),
    other = request.agent(await ctx.createPeer());
  const patient = request.agent(ctx.app),
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

test("PostgreSQL clinician sharing respects email-bound invitations and immediate consent revocation across instances", async (t) => {
  const ctx = await setup(t),
    owner = request.agent(ctx.app),
    clinician = request.agent(await ctx.createPeer()),
    stranger = request.agent(ctx.app);
  await owner.post("/api/auth/register").send(account("owner")).expect(201);
  await clinician
    .post("/api/auth/register")
    .send(account("clinician"))
    .expect(201);
  await stranger
    .post("/api/auth/register")
    .send(account("stranger"))
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

test("PostgreSQL serializes duplicate registration across separate API instances before sending responses", async (t) => {
  const ctx = await setup(t),
    peer = await ctx.createPeer();
  const results = await Promise.all(
    [ctx.app, peer].map((app) =>
      request(app)
        .post("/api/auth/register")
        .send(account("concurrent-registration")),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(
    (await ctx.app.locals.store.list("user")).filter(
      (user) => user.email === "concurrent-registration@integration.test",
    ).length,
    1,
  );
  assert.equal(await ctx.count("patient"), 1);
  const locks = await ctx.raw.query(
    "SELECT count(*) AS count FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
  );
  assert.equal(Number(locks.rows[0].count), 0);
});

test("PostgreSQL serializes prescription confirmation and dose check-in across separate API instances", async (t) => {
  const ctx = await setup(t),
    peer = await ctx.createPeer(),
    agent = request.agent(ctx.app);
  const cookie = cookieFrom(
    await agent
      .post("/api/auth/register")
      .send(account("concurrent-regimen"))
      .expect(201),
  );
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
  assert.ok(dose);
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
  assert.equal(await ctx.count("medication"), 1);
  assert.equal(await ctx.count("dose"), 5);
});

test("PostgreSQL encrypted records require the original external key after ephemeral restart", async (t) => {
  const ctx = await setup(t),
    key = process.env.DATA_ENCRYPTION_KEY;
  await ctx.app.locals.store.put(
    "verification",
    "key-test",
    { privateNote: "Fictional key continuity case" },
    "household-a",
  );
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  let wrong;
  try {
    wrong = await createStore({ postgresUri: ctx.uri, dataDir: ctx.dir });
    await assert.rejects(wrong.get("verification", "key-test"));
  } finally {
    await wrong?.close();
    process.env.DATA_ENCRYPTION_KEY = key;
  }
  const app = await ctx.restartWithoutLocalData();
  assert.equal(
    (await app.locals.store.get("verification", "key-test")).privateNote,
    "Fictional key continuity case",
  );
  await assert.rejects(readdir(ctx.dir), { code: "ENOENT" });
});

test(
  "PostgreSQL Vercel handler reads a real prescription image and restores reviewed records in a fresh function",
  { timeout: 60_000 },
  async (t) => {
    const ctx = await setup(t);
    process.env.DATABASE_URL = ctx.uri;
    const instance = () =>
      createVercelHandler(async () => {
        const app = await createVercelApp();
        ctx.apps.add(app);
        return app;
      });
    const headers = (call) =>
      call
        .set("Host", "recovertrack-test.vercel.app")
        .set("X-Forwarded-Proto", "https");
    const first = instance();
    const health = await headers(request(first).get("/api/health")).expect(200);
    assert.equal(health.body.database, "postgresql-encrypted");
    assert.match(health.body.ocr, /tesseract/i);
    await headers(request(first).get("/api/state")).expect(401);
    const registered = await headers(request(first).post("/api/auth/register"))
      .send(account("vercel-workflow"))
      .expect(201);
    const cookieHeader = registered.headers["set-cookie"][0];
    for (const flag of [/HttpOnly/, /Secure/, /SameSite=Lax/])
      assert.match(cookieHeader, flag);
    const cookie = cookieFrom(registered);
    const authorized = (call) => headers(call).set("Cookie", cookie);
    const extracted = await authorized(
      request(first).post("/api/prescriptions/upload"),
    )
      .attach(
        "file",
        new URL("../fixtures/prescription-test.png", import.meta.url).pathname,
      )
      .expect(201);
    assert.match(extracted.body.text, /MED-A/i);
    assert.match(extracted.body.engine, /tesseract/i);
    assert.ok(extracted.body.medications.length > 0);
    assert.equal(
      (await authorized(request(first).get("/api/state")).expect(200)).body
        .medications.length,
      0,
    );
    await authorized(
      request(first).post(`/api/prescriptions/${extracted.body.id}/confirm`),
    )
      .send({ medications: [{ ...prescription(), reviewed: false }] })
      .expect(400);
    await authorized(
      request(first).post(`/api/prescriptions/${extracted.body.id}/confirm`),
    )
      .send({ medications: [prescription()] })
      .expect(201);
    await authorized(request(first).post("/api/checkins"))
      .set("Origin", "https://foreign.test")
      .send({ pain: 2, mobility: "assisted", note: "Fictional daily check-in" })
      .expect(403);
    await authorized(request(first).post("/api/checkins"))
      .set("Origin", "https://recovertrack-test.vercel.app")
      .send({ pain: 2, mobility: "assisted", note: "Fictional daily check-in" })
      .expect(201);
    await ctx.app.locals.close();
    ctx.apps.delete(ctx.app);
    await rm(ctx.dir, { recursive: true, force: true });
    const second = instance();
    const restored = (
      await authorized(request(second).get("/api/state")).expect(200)
    ).body;
    assert.equal(restored.user.email, "vercel-workflow@integration.test");
    assert.equal(restored.medications[0].name, "MED-A");
    assert.equal(restored.doses.length, 5);
    assert.equal(restored.checkIns.length, 1);
    assert.equal(restored.prescriptions[0].status, "confirmed");
    const rawRecords = JSON.stringify(
      (await ctx.raw.query("SELECT * FROM recovertrack_records")).rows,
    );
    for (const sensitive of [
      "Fictional recovery patient",
      "fictional-account-passphrase",
      "Fictional daily check-in",
      "MED-A",
    ])
      assert.ok(!rawRecords.includes(sensitive));
    await assert.rejects(readdir(ctx.dir), { code: "ENOENT" });
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { createVercelHandler, validateVercelStorage } from "../server/vercel.mjs";
import { createApp } from "../server/app.mjs";

test("serverless startup requires a durable database and canonical persistent key", () => {
  const valid = { MONGODB_URI: "mongodb://database.test/recovertrack", DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  assert.doesNotThrow(() => validateVercelStorage(valid));
  for (const overrides of [
    { MONGODB_URI: undefined }, { MONGODB_URI: "https://database.test" },
    { DATA_ENCRYPTION_KEY: undefined }, { DATA_ENCRYPTION_KEY: "short" },
    { DATA_ENCRYPTION_KEY: valid.DATA_ENCRYPTION_KEY + "\n" },
  ]) assert.throws(() => validateVercelStorage({ ...valid, ...overrides }));
});

test("concurrent cold requests share initialization and preserve the original API path", async () => {
  let starts = 0;
  const handler = createVercelHandler(async () => {
    starts++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return (req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ path: req.url })); };
  });
  const responses = await Promise.all([
    request(handler).get("/api/health"), request(handler).get("/api/state?day=today"),
  ]);
  assert.equal(starts, 1);
  assert.deepEqual(responses.map((r) => r.body.path), ["/api/health", "/api/state?day=today"]);
});

test("failed serverless initialization is private, uncached and retried on the next request", async (t) => {
  t.mock.method(console, "error", () => {});
  let attempts = 0;
  const handler = createVercelHandler(async () => {
    if (++attempts === 1) throw new Error("private-database-connection-detail");
    return (_req, res) => res.end("restored");
  });
  const failed = await request(handler).get("/api/health").expect(503);
  assert.equal(failed.headers["cache-control"], "no-store");
  assert.equal(failed.headers["retry-after"], "30");
  assert.ok(!failed.text.includes("private-database-connection-detail"));
  await request(handler).get("/api/health").expect(200, "restored");
  assert.equal(attempts, 2);
});

test("default Vercel deployment sends every API path to the function before static fallback", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url)));
  const api = new RegExp(`^${config.routes[0].src}$`);
  for (const endpoint of ["/api", "/api/health", "/api/auth/login", "/api/prescriptions/example/confirm"]) assert.ok(api.test(endpoint));
  assert.ok(!api.test("/api-other"));
  assert.equal(config.routes[0].dest, "/api/index");
  assert.deepEqual(config.routes[1], { handle: "filesystem" });
  assert.equal(config.routes[2].dest, "/index.html");
  assert.equal(config.functions["api/index.mjs"].maxDuration, 60);
  for (const dependency of ["tesseract.js-core", "@tesseract.js-data/eng", "sharp", "@img"]) assert.ok(config.functions["api/index.mjs"].includeFiles.includes(dependency));
});

test("request-time database failures keep private connection details out of responses and logs", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...values) => logs.push(values));
  const marker = "private-connection-error-detail";
  const app = await createApp({
    store: { kind: "test", get: async () => { throw new Error(marker); }, close: async () => {} },
    startWorker: false, serveStatic: false,
  });
  t.after(() => app.locals.close());
  const handler = createVercelHandler(async () => app);
  const response = await request(handler).get("/api/state").set("Cookie", "recovertrack_session=fictional-token").expect(500);
  assert.ok(!response.text.includes(marker));
  assert.ok(logs.length > 0);
  assert.ok(!JSON.stringify(logs).includes(marker));
});

import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.mjs";

test("readiness detects a database outage after initialization without exposing connection details", async (t) => {
  let available = true;
  const store = {
    kind: "postgresql-encrypted",
    ping: async () => {
      if (!available) throw new Error("private-connection-detail");
    },
    get: async () => {
      throw new Error("Health must not read the caller's session");
    },
    close: async () => {},
  };
  const app = await createApp({
    store,
    startWorker: false,
    serveStatic: false,
    intelligenceRequest: async () => Response.json({ ocr: "tesseract.js" }),
  });
  t.after(() => app.locals.close());
  const health = () =>
    request(app)
      .get("/api/health")
      .set("Cookie", "recovertrack_session=fictional-old-session");
  assert.equal((await health().expect(200)).body.status, "ok");
  available = false;
  const failed = await health().expect(503);
  assert.equal(failed.body.code, "database_unreachable");
  assert.equal(failed.headers["cache-control"], "no-store");
  assert.ok(!failed.text.includes("private-connection-detail"));
  available = true;
  assert.equal((await health().expect(200)).body.ocr, "tesseract.js");
});

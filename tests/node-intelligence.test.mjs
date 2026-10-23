import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  calculateRisk,
  parsePrescription,
  createIntelligenceRequest,
} from "../server/intelligence-node.mjs";

const fixtures = JSON.parse(
  await readFile(
    new URL("./fixtures/intelligence-parity.json", import.meta.url),
    "utf8",
  ),
);
const now = new Date(fixtures.now);
const request = createIntelligenceRequest({
  internalToken: "internal-test-token",
  now: () => now,
});
const headers = { "x-internal-token": "internal-test-token" };

async function imageRequest(bytes, type = "image/png") {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type }), "prescription.png");
  return request("http://intelligence/ocr", { method: "POST", headers, body });
}

test(`Node attention rules match ${fixtures.risk.length} Python reference cases`, () => {
  for (const fixture of fixtures.risk) {
    assert.deepEqual(
      calculateRisk(fixture.input, now),
      fixture.expected,
      fixture.name,
    );
  }
});

test(`Node prescription parser matches ${fixtures.parser.length} Python reference cases`, () => {
  for (const fixture of fixtures.parser) {
    assert.deepEqual(
      parsePrescription(fixture.text),
      fixture.expected,
      fixture.text,
    );
  }
});

test("Node intelligence authenticates internal calls and reports bundled OCR health", async () => {
  const health = await request("http://intelligence/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ocrAvailable, true);
  assert.equal(
    (await request("http://intelligence/risk", { method: "POST", body: "{}" }))
      .status,
    401,
  );
  const risk = await request("http://intelligence/risk", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(risk.status, 200);
  assert.equal((await risk.json()).score, null);
  assert.equal(
    (await request("http://intelligence/not-found", { headers })).status,
    404,
  );
});

test("Node risk validation rejects malformed symptom, timezone and timestamp data", async () => {
  for (const payload of [
    { timeZone: "Wrong/Timezone" },
    { checkIns: [{ date: "2026-02-30", pain: 1, mobility: "independent" }] },
    { checkIns: [{ date: "2026-10-23", pain: 11, mobility: "independent" }] },
    { doses: [{ scheduledAt: "2026-10-23T10:00:00", status: "taken" }] },
  ]) {
    assert.equal(
      (
        await request("http://intelligence/risk", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        })
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await request("http://intelligence/risk", {
        method: "POST",
        headers,
        body: "invalid",
      })
    ).status,
    400,
  );
});

test("Node OCR rejects invalid, unsupported, empty and oversized files before recognizing", async () => {
  assert.equal((await imageRequest(Buffer.from("not an image"))).status, 415);
  assert.equal(
    (await imageRequest(Buffer.from("pdf"), "application/pdf")).status,
    415,
  );
  assert.equal((await imageRequest(Buffer.alloc(0))).status, 400);
  assert.equal(
    (await imageRequest(Buffer.alloc(4 * 1024 * 1024 + 1))).status,
    413,
  );
});

test("Node OCR enforces decoded image dimensions and single-frame input", async () => {
  const oversized = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  assert.equal((await imageRequest(oversized)).status, 413);
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50"/></svg>',
  );
  assert.equal((await imageRequest(svg)).status, 415);
  const frames = Buffer.alloc(20 * 40 * 3, 255);
  frames.fill(0, 20 * 20 * 3);
  const animated = await sharp(frames, {
    raw: { width: 20, height: 40, channels: 3, pageHeight: 20 },
  })
    .webp({ loop: 0 })
    .toBuffer();
  assert.equal((await imageRequest(animated, "image/webp")).status, 415);
});

test(
  "Node OCR reads the actual fictional prescription image using bundled English data",
  { timeout: 60_000 },
  async () => {
    const image = await readFile(
      new URL("./fixtures/prescription-test.png", import.meta.url),
    );
    const response = await imageRequest(image);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.engine, "tesseract.js");
    assert.ok(result.text.includes("MED-A"));
    assert.equal(result.medications.length, 2);
    assert.equal(result.medications[0].name, "MED-A");
    assert.equal(result.medications[0].durationDays, 5);
    assert.deepEqual(result.medications[0].times, []);
    assert.equal(result.medications[1].name, "MED-B");
    assert.equal(result.medications[1].durationDays, 3);
    assert.equal(
      result.medications.every((medication) => medication.reviewRequired),
      true,
    );
    assert.equal(result.criticalityFlag, true);
    assert.ok(result.confidenceScore > 0 && result.confidenceScore <= 1);
  },
);

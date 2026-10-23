import test from "node:test";
import assert from "node:assert/strict";
import { configureRenderEnvironment } from "../scripts/start-render.mjs";

test("Render runtime derives its exact HTTPS origin and honors the platform port", () => {
  const configured = configureRenderEnvironment({
    RENDER_EXTERNAL_URL: "https://recovertrack-test.onrender.com",
    PORT: "12345",
    API_PORT: "3001",
    INTELLIGENCE_URL: "https://unused-upstream.invalid",
  });
  assert.equal(configured.ALLOWED_ORIGINS, "https://recovertrack-test.onrender.com");
  assert.equal(configured.PORT, "12345");
  assert.equal(configured.API_PORT, "12345");
  assert.equal(configured.API_HOST, "0.0.0.0");
  assert.equal(configured.COOKIE_SECURE, "true");
  assert.equal(configured.TRUST_PROXY, "1");
  assert.equal(configured.NODE_ENV, "production");
  assert.equal(configured.DATA_DIR, "/app/.data");
  assert.equal("INTELLIGENCE_URL" in configured, false);
});

test("Render runtime preserves explicit origins and fixes its persistent mount path", () => {
  const configured = configureRenderEnvironment({
    ALLOWED_ORIGINS: "https://recovery.example.org/, https://family.example.org",
    RENDER_EXTERNAL_URL: "https://recovertrack-test.onrender.com",
    DATA_DIR: "/persistent/recovery",
  });
  assert.equal(configured.ALLOWED_ORIGINS, "https://recovery.example.org,https://family.example.org");
  assert.equal(configured.DATA_DIR, "/app/.data");
  assert.equal(configured.PORT, "10000");
});

test("Render runtime rejects missing or unsafe origins before starting services", () => {
  assert.throws(() => configureRenderEnvironment({}), /RENDER_EXTERNAL_URL/);
  for (const origin of [
    "http://recovery.example.org",
    "https://" + ["user", "password"].join(":") + "@recovery.example.org",
    "https://recovery.example.org/api",
    "https://recovery.example.org?query=1",
    "https://recovery.example.org#fragment",
  ]) {
    assert.throws(() => configureRenderEnvironment({ ALLOWED_ORIGINS: origin }), /HTTPS/);
  }
});

test("Render runtime rejects invalid public listener ports", () => {
  for (const port of ["0", "65536", "not-a-port", "3001/path"]) {
    assert.throws(() => configureRenderEnvironment({ RENDER_EXTERNAL_URL: "https://recovery.example.org", PORT: port }), /TCP port/);
  }
});

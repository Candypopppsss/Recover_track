import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  vercelConfig,
  writeVercelConfig,
} from "../scripts/configure-vercel.mjs";

test("Vercel routes API requests to the backend before the SPA fallback", () => {
  const config = vercelConfig("https://backend.recovertrack.test/");
  assert.equal(config.framework, "vite");
  assert.equal(config.outputDirectory, "dist");
  assert.deepEqual(config.routes, [
    { src: "/api", dest: "https://backend.recovertrack.test/api" },
    { src: "/api/(.*)", dest: "https://backend.recovertrack.test/api/$1" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ]);
});

test("deployment configuration rejects missing, insecure, or credential-bearing origins", () => {
  for (const origin of [
    undefined,
    "invalid",
    "http://backend.recovertrack.test",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://backend.recovertrack.test/api",
    "https://backend.recovertrack.test?key=private",
    "https://backend.recovertrack.test#fragment",
    ["https://", "user:private", "@backend.recovertrack.test"].join(""),
  ]) {
    assert.throws(
      () => vercelConfig(origin),
      (error) => {
        assert.ok(!error.message.includes("private"));
        return error.message.includes("RECOVERTRACK_API_ORIGIN");
      },
    );
  }
});

test("generated deployment settings stay in a private local configuration file", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "recovertrack-vercel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = await writeVercelConfig(
    "https://backend.recovertrack.test",
    directory,
  );
  const config = JSON.parse(await readFile(destination, "utf8"));
  assert.equal(config.routes[0].dest, "https://backend.recovertrack.test/api");
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(config).includes("TOKEN"), false);
});

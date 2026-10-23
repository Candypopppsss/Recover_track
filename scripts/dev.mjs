import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
const production = process.argv.includes("--production");
const apiPort = process.env.PORT || "3001";
const intelligencePort = process.env.INTELLIGENCE_PORT || "8001";
const env = {
  ...process.env,
  PORT: apiPort,
  INTELLIGENCE_URL:
    process.env.INTELLIGENCE_URL || `http://127.0.0.1:${intelligencePort}`,
  INTERNAL_SERVICE_TOKEN:
    process.env.INTERNAL_SERVICE_TOKEN || randomBytes(32).toString("hex"),
  OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || "1",
  ...(production ? { NODE_ENV: "production" } : {}),
};
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 2500).unref();
  process.exitCode = code;
}
function start(name, command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${name} could not start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${name} stopped (${signal || code}).`);
      stop(code || 1);
    }
  });
  return child;
}
async function ready(url, name) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      /* service is starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `${name} did not become healthy at ${url}. Read its startup output above.`,
  );
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  if (!process.env.INTELLIGENCE_URL) {
    const python =
      process.env.RECOVERTRACK_PYTHON ||
      (existsSync(path.join(root, ".venv/bin/python"))
        ? path.join(root, ".venv/bin/python")
        : "python");
    start("Intelligence service", python, [
      "-m",
      "uvicorn",
      "services.intelligence.app:app",
      "--host",
      "127.0.0.1",
      "--port",
      intelligencePort,
    ]);
  }
  await ready(`${env.INTELLIGENCE_URL}/health`, "Intelligence service");
  start("API", process.execPath, [
    ...(production ? [] : ["--watch"]),
    "server/index.mjs",
  ]);
  await ready(`http://127.0.0.1:${apiPort}/api/health`, "API");
  if (!production)
    start("Web app", process.execPath, [
      "node_modules/vite/bin/vite.js",
      "--host",
      "0.0.0.0",
    ]);
  console.log(
    `RecoverTrack services are running (${production ? "production" : "development"}).`,
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}

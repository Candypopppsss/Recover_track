import { pathToFileURL } from "node:url";

function httpsOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Render requires a valid HTTPS application origin.");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Render application origins must be HTTPS origins without credentials or paths.");
  }
  return parsed.origin;
}

export function configureRenderEnvironment(input = process.env) {
  const configured = { ...input };
  const origins = input.ALLOWED_ORIGINS?.trim() || input.RENDER_EXTERNAL_URL?.trim();
  if (!origins) {
    throw new Error("Set RENDER_EXTERNAL_URL or ALLOWED_ORIGINS before starting the Render service.");
  }
  configured.ALLOWED_ORIGINS = [...new Set(origins.split(",").map((origin) => httpsOrigin(origin.trim())))].join(",");
  const port = String(input.PORT || "10000");
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  Object.assign(configured, {
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    TRUST_PROXY: "1",
    API_HOST: "0.0.0.0",
    PORT: port,
    API_PORT: port,
    DATA_DIR: "/app/.data",
    RECOVERTRACK_PYTHON: input.RECOVERTRACK_PYTHON || "/app/.venv/bin/python",
  });
  // This image runs its own private Python service, rather than a public upstream.
  delete configured.INTELLIGENCE_URL;
  return configured;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const configured = configureRenderEnvironment();
    delete process.env.INTELLIGENCE_URL;
    Object.assign(process.env, configured);
    if (!process.argv.includes("--production")) process.argv.push("--production");
    await import("./dev.mjs");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

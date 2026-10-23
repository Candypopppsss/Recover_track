import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function vercelConfig(apiOrigin) {
  const message =
    "Set RECOVERTRACK_API_ORIGIN to the public HTTPS backend origin, without credentials, paths, queries, or fragments.";
  let url;
  try {
    if (!apiOrigin) throw new Error(message);
    url = new URL(apiOrigin);
  } catch {
    throw new Error(message);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\./.test(hostname)
  ) {
    throw new Error(message);
  }
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: "vite",
    installCommand: "npm ci --no-audit --no-fund",
    buildCommand: "npm run build",
    outputDirectory: "dist",
    routes: [
      { src: "/api", dest: `${url.origin}/api` },
      { src: "/api/(.*)", dest: `${url.origin}/api/$1` },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/index.html" },
    ],
  };
}

export async function writeVercelConfig(apiOrigin, directory = ".vercel") {
  const config = vercelConfig(apiOrigin);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "deploy.json");
  await writeFile(destination, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  return destination;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const destination = await writeVercelConfig(
      process.env.RECOVERTRACK_API_ORIGIN,
    );
    console.log(`Vercel configuration written to ${destination}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

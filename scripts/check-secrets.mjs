#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const credentialPatterns = [
  [
    "private-key",
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  ],
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})\b/g,
  ],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  [
    "api-token",
    /\b(?:sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{24,}|(?:vercel|vcp|vch)_[A-Za-z0-9_-]{20,})\b/g,
  ],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["credentialed-uri", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/"'<>]+:[^\s@/"'<>]+@/gi],
  [
    "secret-literal",
    /\b(?:[A-Za-z_][A-Za-z0-9_]*(?:token|secret|api_?key|access_?key|private_?key|encryption_?key)|token|secret|api_?key|access_?key|private_?key|encryption_?key)\b\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/gi,
  ],
];

function sensitivePath(file) {
  const parts = file.replaceAll("\\", "/").split("/");
  const name = parts.at(-1);
  if (
    parts.some((part) =>
      [".data", ".vercel", ".ssh", ".aws"].includes(part.toLowerCase()),
    )
  ) {
    return "runtime-directory";
  }
  if (/^\.env(?:\..*)?$/i.test(name)) return "environment-file";
  if (/^\.(?:npmrc|pypirc|netrc)$/i.test(name)) return "credential-file";
  if (
    /^(?:credentials?|secrets?|auth)(?:\.(?:json|ya?ml|toml|ini))?$/i.test(name)
  ) {
    return "credential-file";
  }
  if (
    /\.(?:pem|key|p12|pfx|jks)$/i.test(name) ||
    /^id_(?:rsa|ed25519|ecdsa|dsa)$/i.test(name)
  ) {
    return "private-key-file";
  }
  if (/\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(name))
    return "database-file";
  return null;
}

export function scanFile(file, content) {
  const findings = [];
  const category = sensitivePath(file);
  if (category) findings.push({ path: file, line: 1, category });
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  for (const [label, pattern] of credentialPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      if (
        !findings.some(
          (finding) => finding.line === line && finding.category === label,
        )
      ) {
        findings.push({ path: file, line, category: label });
      }
    }
  }
  return findings;
}

export function checkRepository(directory, { includeDist = false } = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const entries = git("ls-files", "--stage", "-z")
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  if (!entries.length) throw new Error("No tracked or staged files to scan.");
  const findings = [];
  const blobs = new Map();
  for (const entry of entries) {
    const parsed = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t(.+)$/s.exec(entry);
    if (!parsed) throw new Error("Could not parse the Git index.");
    const [, mode, object, stage, file] = parsed;
    if (stage !== "0" || (mode !== "100644" && mode !== "100755")) {
      findings.push({
        path: file,
        line: 1,
        category: stage !== "0" ? "unmerged-index" : "unsupported-file-mode",
      });
      continue;
    }
    if (!blobs.has(object)) blobs.set(object, git("cat-file", "blob", object));
    findings.push(...scanFile(file, blobs.get(object)));
  }
  let fileCount = entries.length;
  if (includeDist) {
    const dist = path.join(directory, "dist");
    if (!lstatSync(dist).isDirectory())
      throw new Error("Build output is not a directory.");
    function walk(folder) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const fullPath = path.join(folder, entry.name);
        const file = path
          .relative(directory, fullPath)
          .split(path.sep)
          .join("/");
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile()) {
          fileCount++;
          findings.push(...scanFile(file, readFileSync(fullPath)));
        } else
          findings.push({
            path: file,
            line: 1,
            category: "unsupported-file-mode",
          });
      }
    }
    walk(dist);
  }
  return { fileCount, findings };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== "--dist"))
      throw new Error("Unknown argument.");
    const { fileCount, findings } = checkRepository(process.cwd(), {
      includeDist: args.includes("--dist"),
    });
    for (const finding of findings) console.error(JSON.stringify(finding));
    console.log(
      `Secret check: ${fileCount} files, ${findings.length} findings.`,
    );
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error(
      "Secret check failed: Git index or build assets could not be scanned. Stage files first; use --dist only after building.",
    );
    process.exitCode = 1;
  }
}

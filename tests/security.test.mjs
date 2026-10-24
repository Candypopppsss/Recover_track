import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepository, scanFile } from "../scripts/check-secrets.mjs";

const cli = fileURLToPath(
  new URL("../scripts/check-secrets.mjs", import.meta.url),
);

function repository(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "recovertrack-secrets-"));
  execFileSync("git", ["init", "--quiet", directory]);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    write(file, text) {
      mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      writeFileSync(path.join(directory, file), text);
    },
    stage(file) {
      execFileSync("git", ["add", "--", file], { cwd: directory });
    },
  };
}

test("publication rejects empty environment examples, credential files, runtime data and database files", () => {
  for (const file of [
    ".env",
    ".env.example",
    "deploy/.env.production",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "tls/server.pem",
    "tls/server.key",
    "client.p12",
    "client.pfx",
    ".data/encryption.key",
    ".vercel/project.json",
    ".VERCEL/project.json",
    "backup.sqlite-wal",
    "backup.sqlite-journal",
    "backup.db",
  ]) {
    assert.ok(scanFile(file, "").length > 0, file);
  }
});

test("publication rejects private keys, provider tokens, signed tokens and credentialed URLs", () => {
  const encoded = (object) =>
    Buffer.from(JSON.stringify(object)).toString("base64url");
  const fixtures = [
    ["private-key", "-----BEGIN " + "PRIVATE KEY-----"],
    ["github-token", ["gh", "p_"].join("") + "a".repeat(36)],
    [
      "jwt",
      `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: "fictional-test-record" })}.${"s".repeat(32)}`,
    ],
    [
      "credentialed-uri",
      [
        "mongodb+srv://",
        "fixture",
        ":",
        "not-a-real-password",
        "@",
        "database.example/records",
      ].join(""),
    ],
    ["secret-literal", `const VERCEL_TOKEN = '${"z".repeat(32)}';`],
  ];
  for (const [category, content] of fixtures) {
    const findings = scanFile("config.js", `\n${content}`);
    assert.ok(
      findings.some(
        (finding) => finding.category === category && finding.line === 2,
      ),
      category,
    );
  }
});

test("environment variable names, configuration instructions and fictional passwords are allowed", () => {
  const content = [
    "Use DATA_ENCRYPTION_KEY and INTERNAL_SERVICE_TOKEN from server environment settings.",
    "const database = process.env.MONGODB_URI;",
    'const password = "Fictional-test-passphrase-42!";',
  ].join("\n");
  assert.deepEqual(scanFile("docs/configuration.md", content), []);
});

test("the guard scans staged blobs rather than trusting cleaned working files and never logs credentials", (t) => {
  const repo = repository(t);
  const secret = ["gh", "p_"].join("") + "b".repeat(36);
  repo.write("config.js", `export const value = '${secret}';`);
  repo.stage("config.js");
  repo.write("config.js", "export const value = process.env.API_TOKEN;");
  const result = spawnSync(process.execPath, [cli], {
    cwd: repo.directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /github-token/);
  assert.match(result.stderr, /config\.js/);
  assert.ok(
    !`${result.stdout}${result.stderr}`.includes(secret),
    "credential value must not be logged",
  );
});

test("optional build scanning catches files excluded from Git publication", (t) => {
  const repo = repository(t);
  repo.write("README.md", "# Test fixture\n");
  repo.stage("README.md");
  repo.write("dist/.env.production", "");
  assert.deepEqual(checkRepository(repo.directory).findings, []);
  const checked = checkRepository(repo.directory, { includeDist: true });
  assert.equal(checked.fileCount, 2);
  assert.ok(
    checked.findings.some((finding) => finding.path === "dist/.env.production"),
  );
});

test("large staged assets are scanned through their final byte without logging credentials", (t) => {
  const repo = repository(t);
  const file = "public/downloads/project-record.txt";
  const publicText = "Public project documentation.\n".repeat(40_000);
  assert.ok(Buffer.byteLength(publicText) > 1024 * 1024);
  repo.write(file, publicText);
  repo.stage(file);
  assert.deepEqual(checkRepository(repo.directory), {
    fileCount: 1,
    findings: [],
  });

  const secret = ["gh", "p_"].join("") + "c".repeat(36);
  repo.write(file, `${publicText}${secret}`);
  repo.stage(file);
  const result = spawnSync(process.execPath, [cli], {
    cwd: repo.directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /github-token/);
  assert.match(result.stderr, /"line":40001/);
  assert.ok(
    !`${result.stdout}${result.stderr}`.includes(secret),
    "credential at the end of a large asset must not be logged",
  );
});

test("the guard fails closed for an empty index or missing requested build output", (t) => {
  const repo = repository(t);
  assert.throws(
    () => checkRepository(repo.directory),
    /No tracked or staged files/,
  );
  repo.write("README.md", "# Test fixture\n");
  repo.stage("README.md");
  assert.throws(() => checkRepository(repo.directory, { includeDist: true }));
});

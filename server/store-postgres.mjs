import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import pg from "pg";

function lockId(key) {
  return createHash("sha256")
    .update(String(key))
    .digest()
    .readBigInt64BE(0)
    .toString();
}

export function normalizePostgresUri(uri) {
  const parsed = new URL(uri);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.searchParams.getAll("host").length > 1
  ) {
    throw new Error(
      "Configure a PostgreSQL DATABASE_URL in private environment settings.",
    );
  }
  const host = (
    parsed.searchParams.get("host") || parsed.hostname
  ).toLowerCase();
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
  const mode = parsed.searchParams.get("sslmode");
  const legacySsl = parsed.searchParams.get("ssl");
  const disabled =
    mode === "disable" ||
    (!mode && ["0", "false", "disable"].includes(legacySsl));
  if (disabled && !local) {
    throw new Error("Remote PostgreSQL connections require verified TLS.");
  }
  const requested = Boolean(
    mode ||
    legacySsl ||
    ["sslcert", "sslkey", "sslrootcert", "sslnegotiation"].some((name) =>
      parsed.searchParams.has(name),
    ),
  );
  // Both legacy ssl=no-verify and libpq-compatible sslmode=require can disable
  // certificate checks in pg. Normalize every TLS form, including duplicate
  // query parameters; only explicit/private loopback connections may use none.
  parsed.searchParams.delete("ssl");
  parsed.searchParams.set(
    "sslmode",
    local && (disabled || !requested) ? "disable" : "verify-full",
  );
  return parsed.toString();
}

export async function createPostgresStore({ uri, encrypt, decrypt }) {
  const pool = new pg.Pool({
    connectionString: normalizePostgresUri(uri),
    max: 5,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8000,
    query_timeout: 20_000,
    application_name: "recovertrack",
    allowExitOnIdle: true,
  });
  // An idle socket can close while a serverless instance is suspended. pg drops
  // that connection; the next request reconnects without logging its URI.
  pool.on("error", () => {});
  const context = new AsyncLocalStorage();
  const query = (text, values = []) =>
    (context.getStore()?.client || pool).query(text, values);
  let migration;
  try {
    migration = await pool.connect();
    await migration.query("BEGIN");
    await migration.query(
      "SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '30s'",
    );
    // Cold function instances can initialize together. Serialize DDL to avoid
    // simultaneous CREATE TABLE catalog races, with no manual migration step.
    await migration.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      lockId("recovertrack:schema:v1"),
    ]);
    await migration.query(
      "CREATE TABLE IF NOT EXISTS recovertrack_records (kind TEXT NOT NULL, id TEXT NOT NULL, household TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, PRIMARY KEY (kind, id))",
    );
    await migration.query(
      "CREATE INDEX IF NOT EXISTS recovertrack_records_household ON recovertrack_records (kind, household)",
    );
    await migration.query("COMMIT");
  } catch (error) {
    if (migration) await migration.query("ROLLBACK").catch(() => {});
    migration?.release(true);
    await pool.end();
    throw error;
  }
  migration.release();

  return {
    kind: "postgresql-encrypted",
    ping: () => query("SELECT 1"),
    async exclusive(key, fn) {
      const current = context.getStore();
      if (current) {
        // Nested helpers share the existing transaction and its connection.
        // PostgreSQL transaction advisory locks are reentrant on that session.
        await current.client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          lockId(key),
        ]);
        return fn();
      }
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query("BEGIN");
        // Neon pooled URLs use transaction pooling. Session/startup settings are
        // unsupported there, so apply timeouts only within this transaction.
        await client.query(
          "SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '30s'",
        );
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          lockId(key),
        ]);
        const result = await context.run({ client }, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          broken = true;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
    async get(kind, id) {
      const result = await query(
        "SELECT payload FROM recovertrack_records WHERE kind = $1 AND id = $2",
        [kind, id],
      );
      return result.rows[0] ? decrypt(result.rows[0].payload) : null;
    },
    async put(kind, id, value, household = "") {
      await query(
        "INSERT INTO recovertrack_records (kind, id, household, payload) VALUES ($1, $2, $3, $4) ON CONFLICT (kind, id) DO UPDATE SET household = EXCLUDED.household, payload = EXCLUDED.payload",
        [kind, id, household, encrypt(value)],
      );
      return value;
    },
    async list(kind, household) {
      const result =
        household === undefined
          ? await query(
              "SELECT payload FROM recovertrack_records WHERE kind = $1 ORDER BY id",
              [kind],
            )
          : await query(
              "SELECT payload FROM recovertrack_records WHERE kind = $1 AND household = $2 ORDER BY id",
              [kind, household],
            );
      return result.rows.map((row) => decrypt(row.payload));
    },
    async delete(kind, id) {
      await query(
        "DELETE FROM recovertrack_records WHERE kind = $1 AND id = $2",
        [kind, id],
      );
    },
    close: () => pool.end(),
  };
}

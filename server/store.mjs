import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";

export async function createStore({
  dataDir = process.env.DATA_DIR || path.resolve(".data"),
  memory = false,
  mongoUri = process.env.MONGODB_URI,
  postgresUri = process.env.DATABASE_URL || process.env.POSTGRES_URL,
} = {}) {
  let key;
  if (process.env.DATA_ENCRYPTION_KEY) {
    key = Buffer.from(process.env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length !== 32)
      throw new Error(
        "DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
      );
  } else {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(dataDir, "encryption.key");
    try {
      key = await readFile(keyPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      key = randomBytes(32);
      try {
        await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
      } catch (conflict) {
        if (conflict.code !== "EEXIST") throw conflict;
        key = await readFile(keyPath);
      }
    }
    if (key.length !== 32)
      throw new Error(
        "The persistent encryption key must contain exactly 32 bytes. Restore the original key before opening existing data.",
      );
    await chmod(keyPath, 0o600);
  }
  const encrypt = (object) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(object), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  };
  const decrypt = (encoded) => {
    const packed = Buffer.from(encoded, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  };
  if (postgresUri) {
    const { createPostgresStore } = await import("./store-postgres.mjs");
    return createPostgresStore({ uri: postgresUri, encrypt, decrypt });
  }
  if (mongoUri) {
    const client = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      waitQueueTimeoutMS: 5000,
      socketTimeoutMS: 15_000,
    });
    await client.connect();
    const database = client.db(process.env.MONGODB_DATABASE || "recovertrack");
    const collection = database.collection("records");
    const leases = database.collection("record_locks");
    try {
      await collection.createIndex({ kind: 1, household: 1 });
      await leases.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch (error) {
      await client.close();
      throw error;
    }
    const leaseContext = new AsyncLocalStorage();
    const leaseMilliseconds = 5 * 60_000;
    const leaseSafetyMilliseconds = 30_000;
    const lockUnavailable = () =>
      Object.assign(
        new Error(
          "This recovery update is temporarily busy. Please retry shortly.",
        ),
        { status: 503 },
      );
    const assertLease = () => {
      const current = leaseContext.getStore();
      if (
        current &&
        (current.lost ||
          performance.now() >= current.deadline ||
          performance.now() >= current.maximumDeadline)
      ) {
        current.lost = true;
        throw lockUnavailable();
      }
    };
    async function exclusive(key, fn) {
      const id = createHash("sha256").update(String(key)).digest("hex");
      const owner = randomBytes(24).toString("hex");
      const waitUntil = performance.now() + 20_000;
      let deadline;
      while (true) {
        const started = performance.now();
        try {
          // Server time prevents clock differences between function instances from
          // stealing a valid lease. The update and ownership decision are atomic.
          const available = {
            $lte: [{ $ifNull: ["$expiresAt", new Date(0)] }, "$$NOW"],
          };
          const lease = await leases.findOneAndUpdate(
            { _id: id },
            [
              {
                $set: {
                  owner: { $cond: [available, owner, "$owner"] },
                  expiresAt: {
                    $cond: [
                      available,
                      { $add: ["$$NOW", leaseMilliseconds] },
                      "$expiresAt",
                    ],
                  },
                },
              },
            ],
            { upsert: true, returnDocument: "after", maxTimeMS: 5000 },
          );
          if (lease?.owner === owner) {
            deadline = started + leaseMilliseconds - leaseSafetyMilliseconds;
            break;
          }
        } catch (error) {
          if (error.code !== 11000) {
            // A lost acknowledgement can hide a successful acquisition. Remove
            // only our own lease before returning a generic temporary failure.
            await leases
              .deleteOne(
                { _id: id, owner },
                { maxTimeMS: 5000, timeoutMS: 8000 },
              )
              .catch(() => {});
            throw lockUnavailable();
          }
        }
        if (performance.now() >= waitUntil) throw lockUnavailable();
        await new Promise((resolve) =>
          setTimeout(resolve, 50 + Math.floor(Math.random() * 50)),
        );
      }
      const current = {
        deadline,
        maximumDeadline: performance.now() + 4 * 60_000,
        lost: false,
      };
      let renewing;
      const timer = setInterval(() => {
        if (renewing || current.lost) return;
        const started = performance.now();
        if (started >= current.deadline || started >= current.maximumDeadline) {
          current.lost = true;
          return;
        }
        renewing = leases
          .updateOne(
            { _id: id, owner },
            [{ $set: { expiresAt: { $add: ["$$NOW", leaseMilliseconds] } } }],
            { maxTimeMS: 5000 },
          )
          .then((result) => {
            if (result.matchedCount !== 1) current.lost = true;
            else
              current.deadline =
                started + leaseMilliseconds - leaseSafetyMilliseconds;
          })
          .catch(() => {
            current.lost = true;
          })
          .finally(() => {
            renewing = null;
          });
      }, 20_000);
      timer.unref();
      let result, failure;
      try {
        result = await leaseContext.run(current, async () => {
          assertLease();
          const value = await fn();
          assertLease();
          return value;
        });
      } catch (error) {
        failure = error;
      } finally {
        clearInterval(timer);
        if (renewing) await renewing;
        try {
          // A stale worker must never release a different worker's renewed lease.
          await leases.deleteOne({ _id: id, owner }, { maxTimeMS: 5000 });
        } catch {
          failure ||= lockUnavailable();
        }
      }
      if (failure) throw failure;
      if (current.lost) throw lockUnavailable();
      return result;
    }
    return {
      kind: "mongodb",
      ping: () =>
        database.command({ ping: 1 }, { maxTimeMS: 5000, timeoutMS: 8000 }),
      exclusive,
      get: async (kind, id) => {
        const r = await collection.findOne({ _id: `${kind}:${id}` });
        return r ? decrypt(r.payload) : null;
      },
      put: async (kind, id, value, household = "") => {
        assertLease();
        await collection.replaceOne(
          { _id: `${kind}:${id}` },
          { _id: `${kind}:${id}`, kind, household, payload: encrypt(value) },
          { upsert: true, maxTimeMS: 5000, timeoutMS: 10_000 },
        );
        return value;
      },
      list: async (kind, household) =>
        (
          await collection
            .find({ kind, ...(household !== undefined ? { household } : {}) })
            .toArray()
        ).map((r) => decrypt(r.payload)),
      delete: async (kind, id) => {
        assertLease();
        await collection.deleteOne(
          { _id: `${kind}:${id}` },
          { maxTimeMS: 5000, timeoutMS: 10_000 },
        );
      },
      close: async () => client.close(),
    };
  }
  // Mongo-backed/serverless tasks neither load SQLite nor touch local storage.
  const { DatabaseSync } = await import("node:sqlite");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dbPath = memory
    ? ":memory:"
    : path.join(dataDir, "recovertrack.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, household TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS records_household ON records(kind, household);",
  );
  if (!memory) await chmod(dbPath, 0o600);
  const get = db.prepare(
    "SELECT payload FROM records WHERE kind = ? AND id = ?",
  );
  const put = db.prepare(
    "INSERT INTO records(kind,id,household,payload) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET household=excluded.household,payload=excluded.payload",
  );
  const all = db.prepare("SELECT payload FROM records WHERE kind = ?");
  const householdRecords = db.prepare(
    "SELECT payload FROM records WHERE kind = ? AND household = ?",
  );
  const remove = db.prepare("DELETE FROM records WHERE kind = ? AND id = ?");
  return {
    kind: "sqlite-encrypted",
    ping: async () => db.prepare("SELECT 1").get(),
    get: async (kind, id) => {
      const r = get.get(kind, id);
      return r ? decrypt(r.payload) : null;
    },
    put: async (kind, id, value, household = "") => {
      put.run(kind, id, household, encrypt(value));
      return value;
    },
    list: async (kind, household) =>
      (household === undefined
        ? all.all(kind)
        : householdRecords.all(kind, household)
      ).map((r) => decrypt(r.payload)),
    delete: async (kind, id) => {
      remove.run(kind, id);
    },
    close: async () => db.close(),
  };
}

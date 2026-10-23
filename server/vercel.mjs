import { createApp } from "./app.mjs";
import { createIntelligenceRequest } from "./intelligence-node.mjs";
import { normalizePostgresUri } from "./store-postgres.mjs";

export function validateVercelStorage(environment = process.env) {
  const postgresUri = environment.DATABASE_URL || environment.POSTGRES_URL;
  const uri = postgresUri || environment.MONGODB_URI;
  const encoded = environment.DATA_ENCRYPTION_KEY;
  let configured = uri && /^mongodb(?:\+srv)?:\/\//.test(uri);
  if (postgresUri) {
    try {
      normalizePostgresUri(postgresUri);
      configured = true;
    } catch {
      configured = false;
    }
  }
  if (!configured) {
    throw Object.assign(
      new Error(
        "Database setup is incomplete. Connect a free Neon database in Vercel Storage, or configure a private MONGODB_URI, then redeploy.",
      ),
      { code: "storage_config_missing" },
    );
  }
  if (
    !encoded ||
    Buffer.from(encoded, "base64").length !== 32 ||
    Buffer.from(encoded, "base64").toString("base64") !== encoded
  ) {
    throw Object.assign(
      new Error(
        "A persistent encryption key is required. Configure DATA_ENCRYPTION_KEY in private Vercel settings, then redeploy.",
      ),
      { code: "encryption_key_missing" },
    );
  }
}

export async function createVercelApp() {
  // Functions can disappear between requests. Neither records nor their key may
  // fall back to a temporary local file.
  validateVercelStorage();
  process.env.COOKIE_SECURE = "true";
  process.env.TRUST_PROXY = "1";
  return createApp({
    startWorker: false,
    serveStatic: false,
    intelligenceRequest: createIntelligenceRequest(),
  });
}

export function createVercelHandler(initialize = createVercelApp) {
  let application;
  return async function handler(req, res) {
    try {
      application ||= initialize().catch((error) => {
        application = undefined;
        throw error;
      });
      const app = await application;
      return app(req, res);
    } catch (error) {
      // Connection errors can contain database details. Keep provider logs and
      // public responses free of credentials and connection strings.
      const code = [
        "storage_config_missing",
        "encryption_key_missing",
      ].includes(error.code)
        ? error.code
        : "database_unreachable";
      const messages = {
        storage_config_missing:
          "Database setup is incomplete. Connect a free Neon database in Vercel Storage, or configure a private MONGODB_URI, then redeploy.",
        encryption_key_missing:
          "A persistent encryption key is required. Configure DATA_ENCRYPTION_KEY in private Vercel settings, then redeploy.",
        database_unreachable:
          "RecoverTrack cannot connect to its database. Check the private database connection settings and redeploy, or try again shortly.",
      };
      console.error(`RecoverTrack API initialization failed (${code}).`);
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "30");
      res.end(
        JSON.stringify({ status: "unavailable", code, error: messages[code] }),
      );
    }
  };
}

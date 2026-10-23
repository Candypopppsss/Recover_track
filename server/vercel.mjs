import { createApp } from "./app.mjs";
import { createIntelligenceRequest } from "./intelligence-node.mjs";

export function validateVercelStorage(environment = process.env) {
  const uri = environment.MONGODB_URI;
  const encoded = environment.DATA_ENCRYPTION_KEY;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error("Configure MONGODB_URI in the project's private Vercel environment settings.");
  }
  if (!encoded || Buffer.from(encoded, "base64").length !== 32 ||
      Buffer.from(encoded, "base64").toString("base64") !== encoded) {
    throw new Error("Configure a persistent base64-encoded 32-byte DATA_ENCRYPTION_KEY in private Vercel settings.");
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
    } catch {
      // Connection errors can contain database details. Keep provider logs and
      // public responses free of credentials and connection strings.
      console.error("RecoverTrack API initialization failed. Check private database and encryption settings.");
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "30");
      res.end(JSON.stringify({ error: "RecoverTrack is temporarily unavailable. Please try again shortly." }));
    }
  };
}

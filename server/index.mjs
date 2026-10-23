import { createApp } from "./app.mjs";
const app = await createApp();
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const server = app.listen(port, process.env.API_HOST || "0.0.0.0", () =>
  console.log(`RecoverTrack API listening on port ${port}`),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await app.locals.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);

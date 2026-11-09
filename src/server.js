import { config } from "./config.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";
import { flushBackground } from "./background.js";
import { runJobs } from "./jobs.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Vale API listening on http://localhost:${config.port}`);
});

// Run the regular tasks at start-up and every hour while the server is awake.
// On plans where the server sleeps, also set up an external timer to call
// POST /internal/jobs (see README).
const runJobsSafely = () =>
  runJobs().catch((error) => console.error("[jobs] failed:", error));
runJobsSafely();
setInterval(runJobsSafely, 60 * 60 * 1000).unref();

function shutdown() {
  server.close(() =>
    flushBackground()
      .then(() => pool.end())
      .then(() => process.exit(0))
  );
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

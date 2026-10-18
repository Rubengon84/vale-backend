import { config } from "./config.js";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Vale API listening on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

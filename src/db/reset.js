import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { pool } from "./pool.js";
import { migrate } from "./migrate.js";

// Drops every table and recreates the schema. Development and tests only.
export async function reset() {
  if (config.env === "production") {
    throw new Error("Refusing to reset the database in production");
  }
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await reset();
  } finally {
    await pool.end();
  }
}

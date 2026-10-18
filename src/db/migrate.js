import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { pool } from "./pool.js";

const migrationsDir = new URL("./migrations/", import.meta.url);

// Applies every pending .sql file in migrations/, in name order, each in its
// own transaction.
export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map(({ name }) => name));
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files.filter((name) => !applied.has(name))) {
    const sql = await readFile(new URL(file, migrationsDir), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await migrate();
  } finally {
    await pool.end();
  }
}

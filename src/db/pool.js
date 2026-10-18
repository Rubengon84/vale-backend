import pg from "pg";
import { config, assertConfig } from "../config.js";

assertConfig("databaseUrl");

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  options: `-c timezone=${config.timezone}`,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

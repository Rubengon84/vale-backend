// Recreates the test database schema once before all tests.
export default async function setup() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    process.env.TEST_DATABASE_URL ?? "postgres://vale:vale@localhost:5432/vale_test";
  const { reset } = await import("../src/db/reset.js");
  const { pool } = await import("../src/db/pool.js");
  await reset();
  await pool.end();
}

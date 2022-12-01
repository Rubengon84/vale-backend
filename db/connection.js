import pg from "pg";

const pool = new pg.Pool({
  user: "postgres",
  host: "localhost",
  database: "ValeTest",
  password: "postgres",
  port: 5432,
});

export default pool;

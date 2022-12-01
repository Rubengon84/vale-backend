import db from "../db/connection.js";

export async function getAllUsers() {
  const result = query(`SELECT * FROM users;`);
  return result.rows;
}

export async function createUser(user_id, user_email, user_name, user_last_names) {
  const result = await db.query(
    `WITH e AS (INSERT INTO users (user_id, user_email, user_name, user_last_names)
     VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING RETURNING *)
     SELECT * FROM e UNION SELECT * FROM users WHERE user_id=$1;`,
     [user_id, user_email, user_name, user_last_names]
  );
  return result.rows;
}

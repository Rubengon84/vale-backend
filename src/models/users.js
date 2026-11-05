import { query } from "../db/pool.js";
import { HttpError, notFound } from "../errors.js";

const USER_COLUMNS = "user_id AS id, name, email, photo_url, birth_year, hobbies, role, status";

// Creates the profile on first login. Later calls only refresh the email, so
// changes the user made in the app (name, photo) are kept.
export async function registerUser(userId, { name, email, photo_url }) {
  const { rows } = await query(
    `INSERT INTO users (user_id, name, email, photo_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, users.email), updated_at = now()
     RETURNING ${USER_COLUMNS}, (xmax = 0) AS created`,
    [userId, name, email ?? null, photo_url ?? null]
  );
  const { created, ...user } = rows[0];
  return { user, created };
}

export async function getUser(userId) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE user_id = $1`, [userId]);
  if (rows.length === 0) {
    throw notFound("User");
  }
  return rows[0];
}

const UPDATABLE_FIELDS = ["name", "photo_url", "birth_year", "hobbies"];

export async function updateUser(userId, changes) {
  const fields = UPDATABLE_FIELDS.filter((field) => changes[field] !== undefined);
  const assignments = fields.map((field, index) => `${field} = $${index + 2}`);
  const { rows } = await query(
    `UPDATE users SET ${assignments.join(", ")}, updated_at = now()
     WHERE user_id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, ...fields.map((field) => changes[field])]
  );
  if (rows.length === 0) {
    throw notFound("User");
  }
  return rows[0];
}

// Deletes the user and their sign-ups. Activities they created as an admin
// stay in the programme.
export async function deleteUser(userId) {
  await query("DELETE FROM users WHERE user_id = $1", [userId]);
}

// ---------- Admins ----------

export async function listUsers({ status } = {}) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS},
       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at
     FROM users
     WHERE $1::text IS NULL OR status = $1
     ORDER BY (status = 'pending') DESC, created_at DESC`,
    [status ?? null]
  );
  return rows;
}

export async function updateUserAccess(admin, userId, { role, status }) {
  // An admin cannot lock themselves out by mistake.
  if (userId === admin.id) {
    throw new HttpError(409, "You cannot change your own role or status", "cannot_change_self");
  }
  const { rows } = await query(
    `UPDATE users
     SET role = COALESCE($2, role), status = COALESCE($3, status), updated_at = now()
     WHERE user_id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, role ?? null, status ?? null]
  );
  if (rows.length === 0) {
    throw notFound("User");
  }
  return rows[0];
}

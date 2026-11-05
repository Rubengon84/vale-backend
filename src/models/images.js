import { query, withTransaction } from "../db/pool.js";
import { notFound } from "../errors.js";

// Only admins reach these (see routes/images.js).
async function lockActivity(db, activityId) {
  const { rowCount } = await db.query(
    "SELECT 1 FROM activities WHERE activity_id = $1 FOR UPDATE",
    [activityId]
  );
  if (rowCount === 0) {
    throw notFound("Activity");
  }
}

export async function saveActivityImage(activityId, { data, width, height }) {
  await withTransaction(async (db) => {
    await lockActivity(db, activityId);
    await db.query(
      `INSERT INTO activity_images (activity_id, data, width, height, consent_confirmed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (activity_id) DO UPDATE
         SET data = EXCLUDED.data, width = EXCLUDED.width, height = EXCLUDED.height,
             consent_confirmed_at = now(), updated_at = now()`,
      [activityId, data, width, height]
    );
  });
}

export async function deleteActivityImage(activityId) {
  await withTransaction(async (db) => {
    await lockActivity(db, activityId);
    await db.query("DELETE FROM activity_images WHERE activity_id = $1", [activityId]);
  });
}

// `version` must match the current photo, so links to a replaced photo stop working.
export async function getActivityImage(activityId, version) {
  const { rows } = await query(
    `SELECT data FROM activity_images
     WHERE activity_id = $1
       AND (extract(epoch FROM updated_at) * 1000)::bigint = $2`,
    [activityId, version]
  );
  return rows[0]?.data;
}

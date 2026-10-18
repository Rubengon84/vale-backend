import { query, withTransaction } from "../db/pool.js";
import { forbidden, notFound } from "../errors.js";

async function assertOrganiser(db, userId, activityId) {
  const { rows } = await db.query(
    "SELECT organiser_id FROM activities WHERE activity_id = $1 FOR UPDATE",
    [activityId]
  );
  if (rows.length === 0) {
    throw notFound("Activity");
  }
  if (rows[0].organiser_id !== userId) {
    throw forbidden("Only the organiser can change the photo");
  }
}

export async function saveActivityImage(userId, activityId, { data, width, height }) {
  await withTransaction(async (db) => {
    await assertOrganiser(db, userId, activityId);
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

export async function deleteActivityImage(userId, activityId) {
  await withTransaction(async (db) => {
    await assertOrganiser(db, userId, activityId);
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

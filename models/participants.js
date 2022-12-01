import db from "../db/connection.js";

export async function upsertParticipantsRow(user_id, activity_id, role) {
  const sqlString = `INSERT INTO participants
    (user_id, activity_id, participant_role)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, activity_id) DO UPDATE SET participant_role = $3 RETURNING *;`;
  const result = await db.query(sqlString, [user_id, activity_id, role]);
  return result.rows;
}

export async function getActivitiesByRole( user_id, participant_role) {
  const sqlString = `SELECT * from activities
  LEFT JOIN participants on activities.activity_id = participants.activity_id
  WHERE participants.user_id=$1
  AND participants.participant_role=$2
  AND (activities.date_time > CURRENT_TIMESTAMP);`;
  const result = await db.query(sqlString, [user_id, participant_role]);
  return result.rows;
}
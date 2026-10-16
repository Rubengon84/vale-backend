import { query, withTransaction } from "../db/pool.js";
import { HttpError, conflict, forbidden, notFound } from "../errors.js";

// Columns returned for every activity. $1 is always the current user's id.
const ACTIVITY_SELECT = `
  SELECT
    a.activity_id AS id,
    a.title,
    a.category,
    a.type,
    a.location_name,
    to_char(a.date_time, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS date_time,
    a.description,
    a.max_attendees,
    a.cost::float AS cost,
    json_build_object('id', o.user_id, 'name', o.name, 'photo_url', o.photo_url) AS organiser,
    (SELECT count(*)::int FROM attendees x WHERE x.activity_id = a.activity_id) AS attendee_count,
    EXISTS (SELECT 1 FROM attendees x WHERE x.activity_id = a.activity_id AND x.user_id = $1)
      AS is_attending,
    EXISTS (SELECT 1 FROM interests i WHERE i.activity_id = a.activity_id AND i.user_id = $1)
      AS is_interested,
    a.organiser_id = $1 AS is_organiser
  FROM activities a
  JOIN users o ON o.user_id = a.organiser_id`;

const UPCOMING = "a.date_time > now()";

const escapeLike = (value) => value.replace(/[\\%_]/g, "\\$&");

export async function listActivities(userId, { category, type, location, date } = {}) {
  const { rows } = await query(
    `${ACTIVITY_SELECT}
     WHERE ${UPCOMING}
       AND ($2::text IS NULL OR a.category = $2)
       AND ($3::text IS NULL OR a.type = $3)
       AND ($4::text IS NULL OR a.location_name ILIKE '%' || $4 || '%')
       AND ($5::date IS NULL OR a.date_time::date = $5)
     ORDER BY a.date_time
     LIMIT 200`,
    [userId, category ?? null, type ?? null, location ? escapeLike(location) : null, date ?? null]
  );
  return rows;
}

export async function listMyActivities(userId, role) {
  const condition =
    role === "organiser"
      ? "a.organiser_id = $1"
      : "EXISTS (SELECT 1 FROM attendees x WHERE x.activity_id = a.activity_id AND x.user_id = $1)";
  const { rows } = await query(
    `${ACTIVITY_SELECT} WHERE ${UPCOMING} AND ${condition} ORDER BY a.date_time`,
    [userId]
  );
  return rows;
}

export async function listInterests(userId) {
  const { rows } = await query(
    `${ACTIVITY_SELECT}
     WHERE ${UPCOMING}
       AND EXISTS (SELECT 1 FROM interests i WHERE i.activity_id = a.activity_id AND i.user_id = $1)
     ORDER BY a.date_time`,
    [userId]
  );
  return rows;
}

export async function getActivity(userId, activityId, db = { query }) {
  const { rows } = await db.query(`${ACTIVITY_SELECT} WHERE a.activity_id = $2`, [
    userId,
    activityId,
  ]);
  if (rows.length === 0) {
    throw notFound("Activity");
  }

  // Other members only ever see each other's name and photo.
  const { rows: attendees } = await db.query(
    `SELECT u.user_id AS id, u.name, u.photo_url
     FROM attendees x JOIN users u ON u.user_id = x.user_id
     WHERE x.activity_id = $1
     ORDER BY x.joined_at`,
    [activityId]
  );
  return { ...rows[0], attendees };
}

async function assertInFuture(db, dateTime) {
  const { rows } = await db.query("SELECT $1::timestamptz > now() AS ok", [dateTime]);
  if (!rows[0].ok) {
    throw new HttpError(400, "The date must be in the future", "date_in_past");
  }
}

export async function createActivity(userId, data) {
  return withTransaction(async (db) => {
    await assertInFuture(db, data.date_time);
    const { rows } = await db.query(
      `INSERT INTO activities
         (organiser_id, title, category, type, location_name, date_time, description,
          max_attendees, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING activity_id`,
      [
        userId,
        data.title,
        data.category,
        data.type,
        data.location_name,
        data.date_time,
        data.description,
        data.max_attendees,
        data.cost ?? null,
      ]
    );
    const activityId = rows[0].activity_id;
    await db.query("INSERT INTO attendees (activity_id, user_id) VALUES ($1, $2)", [
      activityId,
      userId,
    ]);
    return getActivity(userId, activityId, db);
  });
}

// Locks the activity row for the rest of the transaction.
async function lockActivity(db, activityId) {
  const { rows } = await db.query(
    `SELECT organiser_id, max_attendees, date_time <= now() AS is_past,
       (SELECT count(*)::int FROM attendees x WHERE x.activity_id = a.activity_id) AS attendee_count
     FROM activities a WHERE activity_id = $1 FOR UPDATE`,
    [activityId]
  );
  if (rows.length === 0) {
    throw notFound("Activity");
  }
  return rows[0];
}

const UPDATABLE_FIELDS = [
  "title",
  "category",
  "type",
  "location_name",
  "date_time",
  "description",
  "max_attendees",
  "cost",
];

export async function updateActivity(userId, activityId, changes) {
  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.organiser_id !== userId) {
      throw forbidden("Only the organiser can change this activity");
    }
    if (activity.is_past) {
      throw conflict("This activity has already happened", "activity_past");
    }
    if (changes.date_time) {
      await assertInFuture(db, changes.date_time);
    }
    if (changes.max_attendees !== undefined && changes.max_attendees < activity.attendee_count) {
      throw conflict(
        `${activity.attendee_count} people are already going`,
        "below_current_attendees"
      );
    }

    const fields = UPDATABLE_FIELDS.filter((field) => changes[field] !== undefined);
    const assignments = fields.map((field, index) => `${field} = $${index + 2}`);
    await db.query(
      `UPDATE activities SET ${assignments.join(", ")}, updated_at = now()
       WHERE activity_id = $1`,
      [activityId, ...fields.map((field) => changes[field])]
    );
    return getActivity(userId, activityId, db);
  });
}

export async function deleteActivity(userId, activityId) {
  await withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.organiser_id !== userId) {
      throw forbidden("Only the organiser can cancel this activity");
    }
    await db.query("DELETE FROM activities WHERE activity_id = $1", [activityId]);
  });
}

export async function joinActivity(userId, activityId) {
  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.is_past) {
      throw conflict("This activity has already happened", "activity_past");
    }
    const { rowCount: alreadyGoing } = await db.query(
      "SELECT 1 FROM attendees WHERE activity_id = $1 AND user_id = $2",
      [activityId, userId]
    );
    if (!alreadyGoing) {
      if (activity.attendee_count >= activity.max_attendees) {
        throw conflict("This activity is full", "activity_full");
      }
      await db.query("INSERT INTO attendees (activity_id, user_id) VALUES ($1, $2)", [
        activityId,
        userId,
      ]);
    }
    return getActivity(userId, activityId, db);
  });
}

export async function leaveActivity(userId, activityId) {
  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.organiser_id === userId) {
      throw conflict("The organiser cannot leave; cancel the activity instead", "organiser");
    }
    await db.query("DELETE FROM attendees WHERE activity_id = $1 AND user_id = $2", [
      activityId,
      userId,
    ]);
    return getActivity(userId, activityId, db);
  });
}

export async function setInterest(userId, activityId, interested) {
  const { rowCount } = await query("SELECT 1 FROM activities WHERE activity_id = $1", [
    activityId,
  ]);
  if (rowCount === 0) {
    throw notFound("Activity");
  }
  await query(
    interested
      ? "INSERT INTO interests (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
      : "DELETE FROM interests WHERE activity_id = $1 AND user_id = $2",
    [activityId, userId]
  );
}

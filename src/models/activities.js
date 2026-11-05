import { query, withTransaction } from "../db/pool.js";
import { HttpError, conflict, notFound } from "../errors.js";
import { imagePath } from "../images.js";

// Columns returned for every activity. $1 is always the current user's id.
const ACTIVITY_SELECT = `
  SELECT
    a.activity_id AS id,
    a.title,
    a.category,
    a.description,
    to_char(a.date_time, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS date_time,
    a.location_name,
    a.meeting_point,
    a.transport,
    a.price::float AS price,
    a.status,
    a.participant_places,
    a.volunteer_places,
    c.participants_confirmed,
    c.participants_waiting,
    c.volunteers_confirmed,
    c.volunteers_waiting,
    mine.quota AS my_quota,
    mine.status AS my_status,
    CASE WHEN mine.status = 'waiting' THEN (
      SELECT count(*)::int FROM registrations w
      WHERE w.activity_id = a.activity_id AND w.quota = mine.quota AND w.status = 'waiting'
        AND (w.created_at, w.user_id) <= (mine.created_at, mine.user_id)
    ) END AS my_position,
    (extract(epoch FROM img.updated_at) * 1000)::bigint AS image_version
  FROM activities a
  CROSS JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE quota = 'participant' AND status = 'confirmed')::int AS participants_confirmed,
      count(*) FILTER (WHERE quota = 'participant' AND status = 'waiting')::int AS participants_waiting,
      count(*) FILTER (WHERE quota = 'volunteer' AND status = 'confirmed')::int AS volunteers_confirmed,
      count(*) FILTER (WHERE quota = 'volunteer' AND status = 'waiting')::int AS volunteers_waiting
    FROM registrations r WHERE r.activity_id = a.activity_id
  ) c
  LEFT JOIN registrations mine ON mine.activity_id = a.activity_id AND mine.user_id = $1
  LEFT JOIN activity_images img ON img.activity_id = a.activity_id`;

// Members only see what the association has published (or later cancelled);
// admins also see drafts.
const visibleTo = (user) =>
  user.role === "admin" ? "TRUE" : "a.status IN ('published', 'cancelled')";

function present(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    date_time: row.date_time,
    location_name: row.location_name,
    meeting_point: row.meeting_point,
    transport: row.transport,
    price: row.price,
    status: row.status,
    participants: {
      places: row.participant_places,
      confirmed: row.participants_confirmed,
      waiting: row.participants_waiting,
    },
    volunteers: {
      places: row.volunteer_places,
      confirmed: row.volunteers_confirmed,
      waiting: row.volunteers_waiting,
    },
    my_registration: row.my_quota
      ? { quota: row.my_quota, status: row.my_status, position: row.my_position }
      : null,
    image_path: row.image_version ? imagePath(row.id, row.image_version) : null,
  };
}

// `month` is "YYYY-MM": the whole month, for the calendar. Without it, only
// upcoming activities.
export async function listActivities(user, { month, category } = {}) {
  const { rows } = await query(
    `${ACTIVITY_SELECT}
     WHERE ${visibleTo(user)}
       AND CASE WHEN $2::date IS NULL THEN a.date_time > now()
                ELSE a.date_time >= $2::date AND a.date_time < $2::date + interval '1 month' END
       AND ($3::text IS NULL OR a.category = $3)
     ORDER BY a.date_time
     LIMIT 300`,
    [user.id, month ? `${month}-01` : null, category ?? null]
  );
  return rows.map(present);
}

// "Mis planes": upcoming activities I have a place in or am waiting for,
// including ones the association cancelled, so I find out.
export async function listMyPlans(user) {
  const { rows } = await query(
    `${ACTIVITY_SELECT}
     WHERE mine.user_id IS NOT NULL AND a.status <> 'draft' AND a.date_time > now()
     ORDER BY a.date_time`,
    [user.id]
  );
  return rows.map(present);
}

export async function getActivity(user, activityId, db = { query }) {
  const { rows } = await db.query(
    `${ACTIVITY_SELECT} WHERE a.activity_id = $2 AND ${visibleTo(user)}`,
    [user.id, activityId]
  );
  if (rows.length === 0) {
    throw notFound("Activity");
  }

  // Other members only ever see each other's name and photo.
  const { rows: going } = await db.query(
    `SELECT u.user_id AS id, u.name, u.photo_url, r.quota
     FROM registrations r JOIN users u ON u.user_id = r.user_id
     WHERE r.activity_id = $1 AND r.status = 'confirmed'
     ORDER BY r.created_at, r.user_id`,
    [activityId]
  );
  const person = ({ id, name, photo_url }) => ({ id, name, photo_url });
  return {
    ...present(rows[0]),
    going: {
      participants: going.filter((p) => p.quota === "participant").map(person),
      volunteers: going.filter((p) => p.quota === "volunteer").map(person),
    },
  };
}

async function assertInFuture(db, dateTime) {
  const { rows } = await db.query("SELECT $1::timestamptz > now() AS ok", [dateTime]);
  if (!rows[0].ok) {
    throw new HttpError(400, "The date must be in the future", "date_in_past");
  }
}

// Locks the activity row for the rest of the transaction, so sign-ups and
// changes to the number of places never overbook.
async function lockActivity(db, activityId) {
  const { rows } = await db.query(
    `SELECT status, participant_places, volunteer_places, date_time <= now() AS is_past
     FROM activities WHERE activity_id = $1 FOR UPDATE`,
    [activityId]
  );
  if (rows.length === 0) {
    throw notFound("Activity");
  }
  return rows[0];
}

async function confirmedCount(db, activityId, quota) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM registrations
     WHERE activity_id = $1 AND quota = $2 AND status = 'confirmed'`,
    [activityId, quota]
  );
  return rows[0].n;
}

const placesFor = (activity, quota) =>
  quota === "participant" ? activity.participant_places : activity.volunteer_places;

// Gives free places to the waiting list, first come first served.
// Returns the ids of the people promoted (for notifications later).
async function promoteWaiting(db, activityId, quota, places) {
  const free = places - (await confirmedCount(db, activityId, quota));
  if (free <= 0) {
    return [];
  }
  const { rows } = await db.query(
    `UPDATE registrations SET status = 'confirmed'
     WHERE (activity_id, user_id) IN (
       SELECT activity_id, user_id FROM registrations
       WHERE activity_id = $1 AND quota = $2 AND status = 'waiting'
       ORDER BY created_at, user_id
       LIMIT $3
     )
     RETURNING user_id`,
    [activityId, quota, free]
  );
  return rows.map((row) => row.user_id);
}

// ---------- Members ----------

export async function register(user, activityId) {
  if (user.role !== "participant" && user.role !== "volunteer") {
    throw new HttpError(403, "Only participants and volunteers can sign up", "forbidden");
  }
  const quota = user.role;

  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.status === "draft") {
      throw notFound("Activity");
    }
    if (activity.status === "cancelled") {
      throw conflict("This activity has been cancelled", "activity_cancelled");
    }
    if (activity.is_past) {
      throw conflict("This activity has already happened", "activity_past");
    }
    const places = placesFor(activity, quota);
    if (places === 0) {
      throw conflict("This activity has no places for your role", "no_places_for_role");
    }

    const { rowCount: alreadyRegistered } = await db.query(
      "SELECT 1 FROM registrations WHERE activity_id = $1 AND user_id = $2",
      [activityId, user.id]
    );
    if (!alreadyRegistered) {
      const full = (await confirmedCount(db, activityId, quota)) >= places;
      await db.query(
        `INSERT INTO registrations (activity_id, user_id, quota, status)
         VALUES ($1, $2, $3, $4)`,
        [activityId, user.id, quota, full ? "waiting" : "confirmed"]
      );
    }
    return getActivity(user, activityId, db);
  });
}

async function removeRegistration(db, activityId, userId) {
  const activity = await lockActivity(db, activityId);
  const { rows } = await db.query(
    "DELETE FROM registrations WHERE activity_id = $1 AND user_id = $2 RETURNING quota, status",
    [activityId, userId]
  );
  if (rows[0]?.status === "confirmed") {
    await promoteWaiting(db, activityId, rows[0].quota, placesFor(activity, rows[0].quota));
  }
  return activity;
}

export async function unregister(user, activityId) {
  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (activity.is_past) {
      throw conflict("This activity has already happened", "activity_past");
    }
    await removeRegistration(db, activityId, user.id);
    return getActivity(user, activityId, db);
  });
}

// ---------- Admins ----------

const FIELDS = [
  "title",
  "category",
  "description",
  "date_time",
  "location_name",
  "meeting_point",
  "transport",
  "price",
  "participant_places",
  "volunteer_places",
  "status",
];

export async function createActivity(admin, data) {
  return withTransaction(async (db) => {
    await assertInFuture(db, data.date_time);
    const record = { ...data, status: data.status ?? "draft" };
    const { rows } = await db.query(
      `INSERT INTO activities (created_by, ${FIELDS.join(", ")})
       VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(", ")})
       RETURNING activity_id`,
      [admin.id, ...FIELDS.map((field) => record[field] ?? null)]
    );
    return getActivity(admin, rows[0].activity_id, db);
  });
}

export async function updateActivity(admin, activityId, changes) {
  return withTransaction(async (db) => {
    const activity = await lockActivity(db, activityId);
    if (changes.date_time) {
      await assertInFuture(db, changes.date_time);
    }
    for (const quota of ["participant", "volunteer"]) {
      const places = changes[`${quota}_places`];
      if (places === undefined) continue;
      const confirmed = await confirmedCount(db, activityId, quota);
      if (places < confirmed) {
        throw conflict(
          `${confirmed} people already have a place in this quota`,
          "below_confirmed"
        );
      }
    }

    const fields = FIELDS.filter((field) => changes[field] !== undefined);
    await db.query(
      `UPDATE activities
       SET ${fields.map((field, i) => `${field} = $${i + 2}`).join(", ")}, updated_at = now()
       WHERE activity_id = $1`,
      [activityId, ...fields.map((field) => changes[field])]
    );

    // More places: the waiting list moves up straight away.
    for (const quota of ["participant", "volunteer"]) {
      const places = changes[`${quota}_places`];
      if (places !== undefined && places > placesFor(activity, quota)) {
        await promoteWaiting(db, activityId, quota, places);
      }
    }
    return getActivity(admin, activityId, db);
  });
}

export async function deleteActivity(activityId) {
  const { rowCount } = await query("DELETE FROM activities WHERE activity_id = $1", [activityId]);
  if (rowCount === 0) {
    throw notFound("Activity");
  }
}

// Everyone signed up, in order, with contact details (admins only).
export async function listRegistrations(activityId) {
  const { rowCount } = await query("SELECT 1 FROM activities WHERE activity_id = $1", [
    activityId,
  ]);
  if (rowCount === 0) {
    throw notFound("Activity");
  }
  const { rows } = await query(
    `SELECT u.user_id AS id, u.name, u.email, u.photo_url, r.quota, r.status,
       to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS registered_at
     FROM registrations r JOIN users u ON u.user_id = r.user_id
     WHERE r.activity_id = $1
     ORDER BY r.quota, r.status, r.created_at, r.user_id`,
    [activityId]
  );
  return rows;
}

export async function removeRegistrationByAdmin(activityId, userId) {
  await withTransaction((db) => removeRegistration(db, activityId, userId));
}

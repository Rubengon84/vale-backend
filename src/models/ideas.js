import { query, withTransaction } from "../db/pool.js";
import { HttpError, forbidden, notFound } from "../errors.js";
import { signedImagePath } from "../images.js";
import { inBackground } from "../background.js";
import { notifyIdeaReviewed } from "../notifications.js";

// Columns returned for every idea. $1 is always the current user's id.
const IDEA_SELECT = `
  SELECT
    i.idea_id AS id,
    i.title,
    i.description,
    i.suggested_when,
    i.status,
    i.response,
    to_char(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at,
    json_build_object('id', au.user_id, 'name', au.name) AS author,
    i.author_id = $1 AS is_mine,
    a.activity_id AS activity_id,
    a.title AS activity_title,
    a.status AS activity_status,
    (SELECT count(*)::int FROM idea_interest x WHERE x.idea_id = i.idea_id) AS interest_count,
    EXISTS (SELECT 1 FROM idea_interest x WHERE x.idea_id = i.idea_id AND x.user_id = $1)
      AS i_am_interested,
    (extract(epoch FROM img.updated_at) * 1000)::bigint AS image_version
  FROM ideas i
  JOIN users au ON au.user_id = i.author_id
  LEFT JOIN activities a ON a.activity_id = i.activity_id
  LEFT JOIN idea_images img ON img.idea_id = i.idea_id`;

// Everyone sees ideas the team has reviewed positively; new and declined
// ideas are only visible to their author and the team.
const PUBLIC_STATUSES = "('considering', 'approved')";
const visibleTo = (user) =>
  user.role === "admin" ? "TRUE" : `(i.author_id = $1 OR i.status IN ${PUBLIC_STATUSES})`;

function present(row, user) {
  // A linked activity that is still a draft is only shown to the team.
  const showActivity =
    row.activity_id && (user.role === "admin" || row.activity_status !== "draft");
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    suggested_when: row.suggested_when,
    status: row.status,
    response: row.response,
    created_at: row.created_at,
    author: row.author,
    is_mine: row.is_mine,
    activity: showActivity ? { id: row.activity_id, title: row.activity_title } : null,
    interest_count: row.interest_count,
    i_am_interested: row.i_am_interested,
    image_path: row.image_version ? signedImagePath("ideas", row.id, row.image_version) : null,
  };
}

export async function listMyIdeas(user) {
  const { rows } = await query(
    `${IDEA_SELECT} WHERE i.author_id = $1 ORDER BY i.created_at DESC`,
    [user.id]
  );
  return rows.map((row) => present(row, user));
}

// "Otras propuestas": reviewed ideas from other people, most wanted first.
export async function listCommunityIdeas(user) {
  const { rows } = await query(
    `${IDEA_SELECT}
     WHERE i.status IN ${PUBLIC_STATUSES} AND i.author_id <> $1
     ORDER BY interest_count DESC, i.created_at DESC
     LIMIT 100`,
    [user.id]
  );
  return rows.map((row) => present(row, user));
}

// The team's inbox: new ideas first, then the rest.
export async function listIdeasForAdmin(admin, { status } = {}) {
  const { rows } = await query(
    `${IDEA_SELECT}
     WHERE $2::text IS NULL OR i.status = $2
     ORDER BY (i.status = 'received') DESC, i.created_at DESC
     LIMIT 300`,
    [admin.id, status ?? null]
  );
  return rows.map((row) => present(row, admin));
}

export async function getIdea(user, ideaId, db = { query }) {
  const { rows } = await db.query(
    `${IDEA_SELECT} WHERE i.idea_id = $2 AND ${visibleTo(user)}`,
    [user.id, ideaId]
  );
  if (rows.length === 0) {
    throw notFound("Idea");
  }
  return present(rows[0], user);
}

export async function createIdea(user, { title, description, suggested_when }) {
  const { rows } = await query(
    `INSERT INTO ideas (author_id, title, description, suggested_when)
     VALUES ($1, $2, $3, $4)
     RETURNING idea_id`,
    [user.id, title, description ?? null, suggested_when ?? null]
  );
  return getIdea(user, rows[0].idea_id);
}

// The author or the team can delete an idea.
async function assertCanChange(db, user, ideaId) {
  const { rows } = await db.query(
    "SELECT author_id FROM ideas WHERE idea_id = $1 FOR UPDATE",
    [ideaId]
  );
  if (rows.length === 0) {
    throw notFound("Idea");
  }
  if (rows[0].author_id !== user.id && user.role !== "admin") {
    throw forbidden("Only the author or the VALE team can change this idea");
  }
}

export async function deleteIdea(user, ideaId) {
  await withTransaction(async (db) => {
    await assertCanChange(db, user, ideaId);
    await db.query("DELETE FROM ideas WHERE idea_id = $1", [ideaId]);
  });
}

// "Me gustaría participar" on a reviewed idea.
export async function setInterest(user, ideaId, interested) {
  const idea = await getIdea(user, ideaId);
  if (!["considering", "approved"].includes(idea.status)) {
    throw new HttpError(409, "This idea is not open yet", "idea_not_open");
  }
  await query(
    interested
      ? "INSERT INTO idea_interest (idea_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
      : "DELETE FROM idea_interest WHERE idea_id = $1 AND user_id = $2",
    [ideaId, user.id]
  );
  return getIdea(user, ideaId);
}

// The team's review: status, a reply for the author and, optionally, the
// activity that came out of the idea.
export async function reviewIdea(admin, ideaId, changes) {
  let before;
  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      "SELECT status, response FROM ideas WHERE idea_id = $1 FOR UPDATE",
      [ideaId]
    );
    if (rows.length === 0) {
      throw notFound("Idea");
    }
    before = rows[0];
    if (changes.activity_id) {
      const { rowCount: activityExists } = await db.query(
        "SELECT 1 FROM activities WHERE activity_id = $1",
        [changes.activity_id]
      );
      if (!activityExists) {
        throw new HttpError(400, "That activity does not exist", "activity_not_found");
      }
    }
    const fields = ["status", "response", "activity_id"].filter(
      (field) => changes[field] !== undefined
    );
    await db.query(
      `UPDATE ideas
       SET ${fields.map((field, i) => `${field} = $${i + 3}`).join(", ")},
           reviewed_by = $2, reviewed_at = now(), updated_at = now()
       WHERE idea_id = $1`,
      [ideaId, admin.id, ...fields.map((field) => changes[field])]
    );
    return getIdea(admin, ideaId, db);
  });
  // Tell the author when the status or the reply changes.
  if (
    result.status !== "received" &&
    (result.status !== before.status || (result.response ?? null) !== before.response)
  ) {
    inBackground(() => notifyIdeaReviewed(ideaId), "idea reply email");
  }
  return result;
}

// ---------- Photos ----------

export async function saveIdeaImage(user, ideaId, { data, width, height }) {
  await withTransaction(async (db) => {
    await assertCanChange(db, user, ideaId);
    await db.query(
      `INSERT INTO idea_images (idea_id, data, width, height, consent_confirmed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (idea_id) DO UPDATE
         SET data = EXCLUDED.data, width = EXCLUDED.width, height = EXCLUDED.height,
             consent_confirmed_at = now(), updated_at = now()`,
      [ideaId, data, width, height]
    );
  });
}

export async function deleteIdeaImage(user, ideaId) {
  await withTransaction(async (db) => {
    await assertCanChange(db, user, ideaId);
    await db.query("DELETE FROM idea_images WHERE idea_id = $1", [ideaId]);
  });
}

// `version` must match the current photo, so links to a replaced photo stop working.
export async function getIdeaImage(ideaId, version) {
  const { rows } = await query(
    `SELECT data FROM idea_images
     WHERE idea_id = $1 AND (extract(epoch FROM updated_at) * 1000)::bigint = $2`,
    [ideaId, version]
  );
  return rows[0]?.data;
}

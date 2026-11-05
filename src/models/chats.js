import { query } from "../db/pool.js";
import { HttpError, forbidden, notFound } from "../errors.js";

// Who can use each room. The VALE team (admins) is in every room to moderate.
export const ROOMS = {
  community: ["participant", "volunteer", "admin"],
  participants: ["participant", "admin"],
  volunteers: ["volunteer", "admin"],
};

export const MESSAGES_PER_MINUTE = 10;
const PAGE_SIZE = 50;

const canUse = (user, room) => ROOMS[room]?.includes(user.role) ?? false;

function assertRoom(user, room) {
  if (!ROOMS[room]) {
    throw notFound("Room");
  }
  if (!canUse(user, room)) {
    throw forbidden("This chat is not for your group");
  }
}

async function chatState(userId) {
  const { rows } = await query(
    `SELECT chat_rules_accepted_at IS NOT NULL AS rules_accepted,
            chat_muted_at IS NOT NULL AS muted
     FROM users WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

// The rooms I can use, and whether I have accepted the rules or am paused.
export async function getChatOverview(user) {
  const state = await chatState(user.id);
  return {
    rooms: Object.keys(ROOMS).filter((room) => canUse(user, room)),
    rules_accepted: user.role === "admin" || state.rules_accepted,
    muted: state.muted,
  };
}

export async function acceptRules(user) {
  await query(
    "UPDATE users SET chat_rules_accepted_at = COALESCE(chat_rules_accepted_at, now()) WHERE user_id = $1",
    [user.id]
  );
  return getChatOverview(user);
}

// $1 = current user id, $2 = true for admins (who can see hidden messages).
const MESSAGE_SELECT = `
  SELECT
    m.message_id::int AS id,
    m.room,
    CASE WHEN m.hidden_at IS NULL OR $2 THEN m.body END AS body,
    m.hidden_at IS NOT NULL AS hidden,
    to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at,
    json_build_object('id', u.user_id, 'name', u.name, 'photo_url', u.photo_url) AS author,
    m.author_id = $1 AS is_mine,
    EXISTS (SELECT 1 FROM chat_reports r WHERE r.message_id = m.message_id AND r.reporter_id = $1)
      AS i_reported
  FROM chat_messages m
  JOIN users u ON u.user_id = m.author_id`;

// Latest messages, older ones with `before`, or only new ones with `after`
// (used to check for new messages every few seconds).
export async function listMessages(user, room, { after, before } = {}) {
  assertRoom(user, room);
  const isAdmin = user.role === "admin";
  if (after !== undefined) {
    const { rows } = await query(
      `${MESSAGE_SELECT} WHERE m.room = $3 AND m.message_id > $4
       ORDER BY m.message_id LIMIT 200`,
      [user.id, isAdmin, room, after]
    );
    return rows;
  }
  const { rows } = await query(
    `${MESSAGE_SELECT} WHERE m.room = $3 AND ($4::bigint IS NULL OR m.message_id < $4)
     ORDER BY m.message_id DESC LIMIT ${PAGE_SIZE}`,
    [user.id, isAdmin, room, before ?? null]
  );
  return rows.reverse();
}

async function getMessage(user, messageId) {
  const { rows } = await query(`${MESSAGE_SELECT} WHERE m.message_id = $3`, [
    user.id,
    user.role === "admin",
    messageId,
  ]);
  if (rows.length === 0 || !canUse(user, rows[0].room)) {
    throw notFound("Message");
  }
  return rows[0];
}

export async function postMessage(user, room, body) {
  assertRoom(user, room);
  const state = await chatState(user.id);
  if (user.role !== "admin" && !state.rules_accepted) {
    throw new HttpError(403, "Accept the chat rules first", "chat_rules_required");
  }
  if (state.muted) {
    throw new HttpError(403, "The VALE team has paused your messages", "chat_muted");
  }
  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM chat_messages
     WHERE author_id = $1 AND created_at > now() - interval '1 minute'`,
    [user.id]
  );
  if (recent[0].n >= MESSAGES_PER_MINUTE) {
    throw new HttpError(429, "You are sending messages too fast", "chat_too_fast");
  }
  const { rows } = await query(
    `INSERT INTO chat_messages (room, author_id, body) VALUES ($1, $2, $3)
     RETURNING message_id`,
    [room, user.id, body]
  );
  return getMessage(user, rows[0].message_id);
}

// People can delete their own messages (the team hides instead, see below).
export async function deleteOwnMessage(user, messageId) {
  const message = await getMessage(user, messageId);
  if (!message.is_mine) {
    throw forbidden("You can only delete your own messages");
  }
  await query("DELETE FROM chat_messages WHERE message_id = $1", [messageId]);
}

export async function reportMessage(user, messageId, reason) {
  const message = await getMessage(user, messageId);
  if (message.is_mine) {
    throw new HttpError(409, "You cannot report your own message", "cannot_report_own");
  }
  await query(
    `INSERT INTO chat_reports (message_id, reporter_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (message_id, reporter_id) DO NOTHING`,
    [messageId, user.id, reason ?? null]
  );
}

// ---------- VALE team ----------

export async function listReports({ status = "open" } = {}) {
  const { rows } = await query(
    `SELECT
       r.report_id::int AS id,
       r.reason,
       to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at,
       r.resolved_at IS NOT NULL AS resolved,
       json_build_object('id', rp.user_id, 'name', rp.name) AS reporter,
       json_build_object(
         'id', m.message_id::int,
         'room', m.room,
         'body', m.body,
         'hidden', m.hidden_at IS NOT NULL,
         'created_at', to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM'),
         'author', json_build_object(
           'id', au.user_id, 'name', au.name, 'muted', au.chat_muted_at IS NOT NULL
         )
       ) AS message
     FROM chat_reports r
     JOIN chat_messages m ON m.message_id = r.message_id
     JOIN users rp ON rp.user_id = r.reporter_id
     JOIN users au ON au.user_id = m.author_id
     WHERE $1 = 'all' OR r.resolved_at IS NULL
     ORDER BY r.created_at DESC
     LIMIT 200`,
    [status]
  );
  return rows;
}

export async function resolveReport(admin, reportId) {
  const { rowCount } = await query(
    `UPDATE chat_reports SET resolved_at = now(), resolved_by = $2
     WHERE report_id = $1`,
    [reportId, admin.id]
  );
  if (rowCount === 0) {
    throw notFound("Report");
  }
}

export async function setMessageHidden(admin, messageId, hidden) {
  const { rowCount } = await query(
    `UPDATE chat_messages
     SET hidden_at = CASE WHEN $2 THEN COALESCE(hidden_at, now()) END,
         hidden_by = CASE WHEN $2 THEN $3 END
     WHERE message_id = $1`,
    [messageId, hidden, admin.id]
  );
  if (rowCount === 0) {
    throw notFound("Message");
  }
  return getMessage(admin, messageId);
}

// Messages are kept for 12 months, as agreed with the association.
export async function deleteOldMessages() {
  const { rowCount } = await query(
    "DELETE FROM chat_messages WHERE created_at < now() - interval '12 months'"
  );
  return rowCount;
}

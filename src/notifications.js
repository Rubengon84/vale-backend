// Emails to members, in "Lectura Fácil" Spanish: short sentences, the key
// details on their own lines, and one button. Only to approved accounts with
// email_notifications on. Called through inBackground(), never in a request.
import { config } from "./config.js";
import { query } from "./db/pool.js";
import { sendEmails } from "./email.js";

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RECIPIENT = `u.email IS NOT NULL AND u.email_notifications AND u.status = 'approved'`;

// ---------- Building emails ----------

function render({ to, name, subject, intro, details = [], outro = [], button }) {
  const greeting = `Hola, ${name}:`;
  const footer =
    "Si no quieres recibir estos emails, puedes quitarlos en tu perfil de VALE Conecta.";

  const text = [
    greeting,
    "",
    ...intro,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(details.length ? [""] : []),
    ...outro,
    ...(outro.length ? [""] : []),
    ...(button ? [`${button.label}: ${button.url}`, ""] : []),
    "Equipo VALE",
    "",
    footer,
  ].join("\n");

  const p = (content) => `<p style="margin:0 0 16px">${content}</p>`;
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#eaf2f5;font-family:Arial,sans-serif;font-size:18px;line-height:1.5;color:#1a1a1a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px">
${p(escapeHtml(greeting))}
${intro.map((line) => p(escapeHtml(line))).join("\n")}
${
  details.length
    ? `<table style="margin:0 0 16px;border-collapse:collapse">${details
        .map(
          ([label, value]) =>
            `<tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#173f4f;vertical-align:top">${escapeHtml(
              label
            )}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`
        )
        .join("")}</table>`
    : ""
}
${outro.map((line) => p(escapeHtml(line))).join("\n")}
${
  button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#16758c;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 24px;border-radius:12px">${escapeHtml(
        button.label
      )}</a></p>`
    : ""
}
${p("Equipo VALE")}
<p style="margin:24px 0 0;font-size:14px;color:#4a4a4a">${escapeHtml(footer)}</p>
</div></body></html>`;

  return { to, subject, text, html };
}

const formatDay = (date) =>
  date.toLocaleDateString("es-ES", {
    timeZone: config.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const formatTime = (date) =>
  date.toLocaleTimeString("es-ES", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit" });

const formatPrice = (price) =>
  !price ? "Gratis" : `${Number(price).toLocaleString("es-ES", { maximumFractionDigits: 2 })} €`;

async function loadActivity(activityId) {
  const { rows } = await query(
    `SELECT activity_id AS id, title, date_time, location_name, meeting_point, transport,
            price::float AS price, status, participant_places, volunteer_places
     FROM activities WHERE activity_id = $1`,
    [activityId]
  );
  return rows[0];
}

function activityDetails(activity) {
  const date = new Date(activity.date_time);
  return [
    ["Día", formatDay(date)],
    ["Hora", formatTime(date)],
    ["Lugar", activity.location_name],
    ...(activity.meeting_point ? [["Nos vemos en", activity.meeting_point]] : []),
    ...(activity.transport ? [["Cómo ir", activity.transport]] : []),
    ["Precio", formatPrice(activity.price)],
  ];
}

const activityButton = (activity) => ({
  label: "Ver la actividad",
  url: `${config.appUrl}/activities/${activity.id}`,
});

// People signed up (with a place, or also waiting) for an activity.
async function registeredPeople(activityId, { includeWaiting = true } = {}) {
  const { rows } = await query(
    `SELECT u.name, u.email, r.status FROM registrations r
     JOIN users u ON u.user_id = r.user_id
     WHERE r.activity_id = $1 AND ${RECIPIENT}
       AND ($2 OR r.status = 'confirmed')`,
    [activityId, includeWaiting]
  );
  return rows;
}

// ---------- Activities ----------

// After signing up: a place, or the waiting list with the position.
export async function notifyRegistration(userId, activityId) {
  const { rows } = await query(
    `SELECT u.name, u.email, r.status,
       (SELECT count(*)::int FROM registrations w
        WHERE w.activity_id = r.activity_id AND w.quota = r.quota AND w.status = 'waiting'
          AND (w.created_at, w.user_id) <= (r.created_at, r.user_id)) AS position
     FROM registrations r JOIN users u ON u.user_id = r.user_id
     WHERE r.activity_id = $1 AND r.user_id = $2 AND ${RECIPIENT}`,
    [activityId, userId]
  );
  if (rows.length === 0) return;
  const person = rows[0];
  const activity = await loadActivity(activityId);
  const email =
    person.status === "confirmed"
      ? render({
          to: person.email,
          name: person.name,
          subject: `Tienes plaza: ${activity.title}`,
          intro: [`Ya tienes plaza en «${activity.title}».`, "Te esperamos."],
          details: activityDetails(activity),
          outro: ["Si no puedes ir, entra en la app y pulsa «Ya no puedo ir»."],
          button: activityButton(activity),
        })
      : render({
          to: person.email,
          name: person.name,
          subject: `Estás en la lista de espera: ${activity.title}`,
          intro: [
            `«${activity.title}» está completa.`,
            `Estás en la lista de espera. Eres el número ${person.position}.`,
            "Si queda una plaza libre, te la daremos y te avisaremos.",
          ],
          details: activityDetails(activity),
          button: activityButton(activity),
        });
  await sendEmails([email]);
}

// Someone left and the waiting list moved up.
export async function notifyPromoted(userIds, activityId) {
  if (userIds.length === 0) return;
  const { rows } = await query(
    `SELECT u.name, u.email FROM users u WHERE u.user_id = ANY($1) AND ${RECIPIENT}`,
    [userIds]
  );
  if (rows.length === 0) return;
  const activity = await loadActivity(activityId);
  await sendEmails(
    rows.map((person) =>
      render({
        to: person.email,
        name: person.name,
        subject: `¡Ya tienes plaza! ${activity.title}`,
        intro: [
          `Estabas en la lista de espera de «${activity.title}».`,
          "¡Ha quedado una plaza libre y ahora es para ti!",
        ],
        details: activityDetails(activity),
        outro: ["Si ya no puedes ir, entra en la app y pulsa «Ya no puedo ir»."],
        button: activityButton(activity),
      })
    )
  );
}

// A new activity in the programme: to everyone who can sign up for it.
export async function notifyPublished(activityId) {
  const activity = await loadActivity(activityId);
  const { rows } = await query(
    `SELECT u.name, u.email FROM users u
     WHERE ${RECIPIENT}
       AND ((u.role = 'participant' AND $1 > 0) OR (u.role = 'volunteer' AND $2 > 0))`,
    [activity.participant_places, activity.volunteer_places]
  );
  await sendEmails(
    rows.map((person) =>
      render({
        to: person.email,
        name: person.name,
        subject: `Nueva actividad: ${activity.title}`,
        intro: [`Hay una actividad nueva: «${activity.title}».`, "¿Te apuntas?"],
        details: activityDetails(activity),
        button: { label: "Ver y apuntarme", url: activityButton(activity).url },
      })
    )
  );
}

const CHANGE_LABELS = {
  date_time: "el día o la hora",
  location_name: "el lugar",
  meeting_point: "el punto de encuentro",
  transport: "el transporte",
  price: "el precio",
};

// Important details changed: to everyone signed up.
export async function notifyChanged(activityId, changedFields) {
  const activity = await loadActivity(activityId);
  const people = await registeredPeople(activityId);
  const what = changedFields.map((field) => CHANGE_LABELS[field]);
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} y ${what.at(-1)}` : what[0];
  await sendEmails(
    people.map((person) =>
      render({
        to: person.email,
        name: person.name,
        subject: `Cambios en ${activity.title}`,
        intro: [`Hemos cambiado ${list} de «${activity.title}».`, "Así queda ahora:"],
        details: activityDetails(activity),
        outro: ["Si ya no puedes ir, entra en la app y pulsa «Ya no puedo ir»."],
        button: activityButton(activity),
      })
    )
  );
}

export async function notifyCancelled(activityId) {
  const activity = await loadActivity(activityId);
  const people = await registeredPeople(activityId);
  const date = new Date(activity.date_time);
  await sendEmails(
    people.map((person) =>
      render({
        to: person.email,
        name: person.name,
        subject: `Se ha cancelado: ${activity.title}`,
        intro: [
          `Lo sentimos. Hemos cancelado «${activity.title}» del ${formatDay(date)}.`,
          "Mira otras actividades en la app.",
        ],
        button: { label: "Ver actividades", url: `${config.appUrl}/activities` },
      })
    )
  );
}

// The day before: activities starting in the next 24 hours, once each.
// Returns how many activities got reminders.
export async function sendDueReminders() {
  const { rows: due } = await query(
    `UPDATE activities SET reminder_sent_at = now()
     WHERE status = 'published' AND reminder_sent_at IS NULL
       AND date_time > now() AND date_time <= now() + interval '24 hours'
     RETURNING activity_id`
  );
  for (const { activity_id: activityId } of due) {
    const activity = await loadActivity(activityId);
    const people = await registeredPeople(activityId, { includeWaiting: false });
    await sendEmails(
      people.map((person) =>
        render({
          to: person.email,
          name: person.name,
          subject: `Recordatorio: ${activity.title}`,
          intro: [`Te recordamos que pronto es «${activity.title}».`, "¡Te esperamos!"],
          details: activityDetails(activity),
          outro: ["Si no puedes ir, entra en la app y pulsa «Ya no puedo ir»."],
          button: activityButton(activity),
        })
      )
    );
  }
  return due.length;
}

// ---------- Accounts and ideas ----------

export async function notifyAccountApproved(userId) {
  const { rows } = await query(
    `SELECT u.name, u.email FROM users u WHERE u.user_id = $1 AND ${RECIPIENT}`,
    [userId]
  );
  if (rows.length === 0) return;
  await sendEmails([
    render({
      to: rows[0].email,
      name: rows[0].name,
      subject: "Tu cuenta de VALE Conecta está lista",
      intro: [
        "¡Bienvenido o bienvenida a VALE Conecta!",
        "El equipo de VALE ha aprobado tu cuenta.",
        "Ya puedes ver las actividades y apuntarte.",
      ],
      button: { label: "Entrar en VALE Conecta", url: config.appUrl },
    }),
  ]);
}

const IDEA_STATUS_TEXT = {
  considering: "Estamos estudiando tu idea.",
  approved: "¡Tu idea está aprobada!",
  declined: "Ahora no podemos hacer tu idea.",
};

export async function notifyIdeaReviewed(ideaId) {
  const { rows } = await query(
    `SELECT i.title, i.status, i.response, u.name, u.email,
            a.activity_id, a.status AS activity_status
     FROM ideas i JOIN users u ON u.user_id = i.author_id
     LEFT JOIN activities a ON a.activity_id = i.activity_id
     WHERE i.idea_id = $1 AND ${RECIPIENT}`,
    [ideaId]
  );
  const idea = rows[0];
  if (!idea || !IDEA_STATUS_TEXT[idea.status]) return;
  const hasActivity = idea.activity_id && idea.activity_status === "published";
  await sendEmails([
    render({
      to: idea.email,
      name: idea.name,
      subject: `Respuesta a tu idea: ${idea.title}`,
      intro: [`Gracias por tu idea «${idea.title}».`, IDEA_STATUS_TEXT[idea.status]],
      outro: idea.response ? [`El equipo de VALE dice: ${idea.response}`] : [],
      button: hasActivity
        ? { label: "Ver la actividad", url: `${config.appUrl}/activities/${idea.activity_id}` }
        : { label: "Ver mis ideas", url: `${config.appUrl}/ideas` },
    }),
  ]);
}

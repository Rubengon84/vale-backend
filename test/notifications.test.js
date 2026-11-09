import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { config } from "../src/config.js";
import { flushBackground } from "../src/background.js";
import { sendEmails, setEmailTransport } from "../src/email.js";
import { runJobs } from "../src/jobs.js";
import {
  app,
  approvedUser,
  as,
  closeDatabase,
  createActivity,
  daysFromNow,
  registerUser,
  resetData,
} from "./helpers.js";

let sent;
beforeEach(async () => {
  await resetData();
  sent = [];
  setEmailTransport(async (emails) => sent.push(...emails));
  await approvedUser("auth0|admin", "admin", "Equipo");
  await approvedUser("auth0|ana", "participant", "Ana");
  await approvedUser("auth0|ben", "participant", "Ben");
  await approvedUser("auth0|vera", "volunteer", "Vera");
});
afterAll(async () => {
  setEmailTransport(null);
  await closeDatabase();
});

// Emails are sent in the background after the request answers.
async function emails() {
  await flushBackground();
  const list = sent;
  sent = [];
  return list;
}
const subjects = (list) => list.map((e) => [e.to, e.subject]).sort();

const join = (userId, id) => as(userId).put(`/activities/${id}/registration`).expect(200);

describe("activity emails", () => {
  it("announces a published activity to the people who can sign up", async () => {
    await registerUser("auth0|pending", "Pendiente");
    await approvedUser("auth0|quiet", "participant", "Quiet");
    await as("auth0|quiet").patch("/users/me").send({ email_notifications: false });

    const draft = await createActivity("auth0|admin", { status: "draft", volunteer_places: 0 });
    expect(await emails()).toEqual([]);

    await as("auth0|admin").patch(`/activities/${draft.id}`).send({ status: "published" });
    // Not the volunteer (no volunteer places), the admin, a pending account or
    // someone who turned emails off.
    expect(subjects(await emails())).toEqual([
      ["Ana@example.org", "Nueva actividad: Cine en Granada"],
      ["Ben@example.org", "Nueva actividad: Cine en Granada"],
    ]);

    await createActivity("auth0|admin", { title: "Ruta", volunteer_places: 2 });
    expect((await emails()).map((e) => e.to).sort()).toEqual([
      "Ana@example.org",
      "Ben@example.org",
      "Vera@example.org",
    ]);
  });

  it("confirms a place with all the details and a link", async () => {
    const activity = await createActivity("auth0|admin", { date_time: daysFromNow(5, "17:00") });
    await emails();
    await join("auth0|ana", activity.id);

    const [email] = await emails();
    expect(email).toMatchObject({ to: "Ana@example.org", subject: "Tienes plaza: Cine en Granada" });
    for (const text of ["Hola, Ana:", "Hora: 17:00", "Lugar: Cines Kinépolis", "Nos vemos en: Puerta del cine", "Cómo ir: Autobús 9", "Precio: 6 €", `${config.appUrl}/activities/${activity.id}`, "quitarlos en tu perfil"]) {
      expect(email.text).toContain(text);
    }
    expect(email.html).toContain(`href="${config.appUrl}/activities/${activity.id}"`);

    // Signing up twice does not send a second email.
    await join("auth0|ana", activity.id);
    expect(await emails()).toEqual([]);
  });

  it("tells people their waiting-list position, and when they get a place", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await emails(); // the "new activity" emails
    await join("auth0|ana", activity.id);
    await join("auth0|ben", activity.id);
    const waiting = (await emails()).find((e) => e.to === "Ben@example.org");
    expect(waiting.subject).toBe("Estás en la lista de espera: Cine en Granada");
    expect(waiting.text).toContain("Eres el número 1.");

    await as("auth0|ana").delete(`/activities/${activity.id}/registration`).expect(200);
    expect(subjects(await emails())).toEqual([["Ben@example.org", "¡Ya tienes plaza! Cine en Granada"]]);
  });

  it("emails people promoted when an admin adds places or removes someone", async () => {
    await approvedUser("auth0|cai", "participant", "Cai");
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    for (const user of ["auth0|ana", "auth0|ben", "auth0|cai"]) await join(user, activity.id);
    await emails();

    await as("auth0|admin").patch(`/activities/${activity.id}`).send({ participant_places: 2 });
    expect(subjects(await emails())).toEqual([["Ben@example.org", "¡Ya tienes plaza! Cine en Granada"]]);

    await as("auth0|admin").delete(`/admin/activities/${activity.id}/registrations/auth0|ana`);
    expect(subjects(await emails())).toEqual([["Cai@example.org", "¡Ya tienes plaza! Cine en Granada"]]);
  });

  it("tells everyone signed up about important changes, not small ones", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await join("auth0|ana", activity.id);
    await join("auth0|ben", activity.id);
    await emails();

    await as("auth0|admin").patch(`/activities/${activity.id}`).send({ description: "Otra descripción" });
    expect(await emails()).toEqual([]);

    await as("auth0|admin")
      .patch(`/activities/${activity.id}`)
      .send({ date_time: daysFromNow(9, "18:30"), location_name: "Cines Nevada" });
    const changed = await emails();
    expect(subjects(changed)).toEqual([
      ["Ana@example.org", "Cambios en Cine en Granada"],
      ["Ben@example.org", "Cambios en Cine en Granada"],
    ]);
    expect(changed[0].text).toContain("Hemos cambiado el día o la hora y el lugar");
    expect(changed[0].text).toContain("Lugar: Cines Nevada");
  });

  it("tells everyone signed up when an activity is cancelled", async () => {
    const activity = await createActivity("auth0|admin");
    await join("auth0|ana", activity.id);
    await emails();
    await as("auth0|admin").patch(`/activities/${activity.id}`).send({ status: "cancelled" });
    expect(subjects(await emails())).toEqual([["Ana@example.org", "Se ha cancelado: Cine en Granada"]]);
  });

  it("sends one reminder the day before, only to people with a place", async () => {
    const soon = await createActivity("auth0|admin", { participant_places: 1 });
    const later = await createActivity("auth0|admin", { title: "Más tarde" });
    await join("auth0|ana", soon.id);
    await join("auth0|ben", soon.id);
    await join("auth0|ana", later.id);
    await pool.query("UPDATE activities SET date_time = now() + interval '20 hours' WHERE activity_id = $1", [soon.id]);
    await emails();

    expect((await runJobs()).reminders).toBe(1);
    expect(subjects(await emails())).toEqual([["Ana@example.org", "Recordatorio: Cine en Granada"]]);
    expect((await runJobs()).reminders).toBe(0);
    expect(await emails()).toEqual([]);
  });

  it("escapes HTML from titles", async () => {
    await createActivity("auth0|admin", { title: "<b>Fiesta</b> & baile" });
    const [email] = await emails();
    expect(email.html).toContain("&lt;b&gt;Fiesta&lt;/b&gt; &amp; baile");
    expect(email.html).not.toContain("<b>Fiesta</b>");
  });
});

describe("account and idea emails", () => {
  it("welcomes people when their account is approved", async () => {
    await registerUser("auth0|new", "Nuevo");
    await as("auth0|admin").patch("/admin/users/auth0|new").send({ role: "volunteer", status: "approved" });
    expect(subjects(await emails())).toEqual([["Nuevo@example.org", "Tu cuenta de VALE Conecta está lista"]]);

    await as("auth0|admin").patch("/admin/users/auth0|new").send({ role: "participant" });
    expect(await emails()).toEqual([]);
  });

  it("tells authors when the team answers their idea", async () => {
    const { body } = await as("auth0|ana").post("/ideas").send({ title: "Concierto" });
    const review = (changes) => as("auth0|admin").patch(`/admin/ideas/${body.idea.id}`).send(changes);

    await review({ status: "considering", response: "¡Buena idea!" });
    const [email] = await emails();
    expect(email).toMatchObject({ to: "Ana@example.org", subject: "Respuesta a tu idea: Concierto" });
    expect(email.text).toContain("Estamos estudiando tu idea.");
    expect(email.text).toContain("El equipo de VALE dice: ¡Buena idea!");

    await review({ status: "considering" });
    expect(await emails()).toEqual([]);

    const activity = await createActivity("auth0|admin");
    await emails();
    await review({ status: "approved", activity_id: activity.id });
    const [approved] = await emails();
    expect(approved.text).toContain("¡Tu idea está aprobada!");
    expect(approved.text).toContain(`${config.appUrl}/activities/${activity.id}`);
  });
});

describe("POST /internal/jobs", () => {
  afterEach(() => {
    config.cronSecret = undefined;
  });

  it("only runs with the secret", async () => {
    await request(app).post("/internal/jobs").expect(404);
    config.cronSecret = "s3cret";
    await request(app).post("/internal/jobs").set("Authorization", "Bearer wrong").expect(404);
    const res = await request(app)
      .post("/internal/jobs")
      .set("Authorization", "Bearer s3cret")
      .expect(200);
    expect(res.body).toEqual({ reminders: 0, deleted_messages: 0 });
  });
});

describe("Resend", () => {
  afterEach(() => {
    config.email.resendApiKey = undefined;
    setEmailTransport(async (list) => sent.push(...list));
    vi.unstubAllGlobals();
  });

  it("sends batches of up to 100, one recipient per email", async () => {
    setEmailTransport(null);
    config.email.resendApiKey = "re_test";
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);

    const list = Array.from({ length: 150 }, (_, i) => ({
      to: `p${i}@example.org`,
      subject: "Hola",
      text: "Texto",
      html: "<p>Texto</p>",
    }));
    await sendEmails(list);

    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails/batch");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body).toHaveLength(100);
    expect(body[0]).toEqual({
      from: config.email.from,
      to: ["p0@example.org"],
      subject: "Hola",
      text: "Texto",
      html: "<p>Texto</p>",
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toHaveLength(50);
  });

  it("reports Resend errors", async () => {
    setEmailTransport(null);
    config.email.resendApiKey = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad from" }));
    await expect(sendEmails([{ to: "a@b.c", subject: "x", text: "x", html: "x" }])).rejects.toThrow(
      "Resend answered 422: bad from"
    );
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  approvedUser,
  as,
  createActivity,
  daysFromNow,
  resetData,
  validActivity,
} from "./helpers.js";

beforeEach(async () => {
  await resetData();
  await approvedUser("auth0|admin", "admin", "Equipo");
  await approvedUser("auth0|ana", "participant", "Ana");
  await approvedUser("auth0|ben", "participant", "Ben");
  await approvedUser("auth0|cai", "participant", "Cai");
  await approvedUser("auth0|vera", "volunteer", "Vera");
  await approvedUser("auth0|vito", "volunteer", "Vito");
});
afterAll(() => pool.end());

const join = (userId, id) => as(userId).put(`/activities/${id}/registration`);
const leave = (userId, id) => as(userId).delete(`/activities/${id}/registration`);

describe("managing the programme", () => {
  it("lets admins create an activity with all its details", async () => {
    const activity = await createActivity("auth0|admin", { price: 0 });
    expect(activity).toMatchObject({
      title: "Cine en Granada",
      category: "culturales",
      location_name: "Cines Kinépolis",
      meeting_point: "Puerta del cine",
      transport: "Autobús 9",
      price: 0,
      status: "published",
      participants: { places: 2, confirmed: 0, waiting: 0 },
      volunteers: { places: 1, confirmed: 0, waiting: 0 },
      my_registration: null,
      going: { participants: [], volunteers: [] },
    });
  });

  it("does not let participants or volunteers create, edit or delete activities", async () => {
    await as("auth0|ana").post("/activities").send(validActivity()).expect(403);
    await as("auth0|vera").post("/activities").send(validActivity()).expect(403);
    const activity = await createActivity("auth0|admin");
    await as("auth0|ana").patch(`/activities/${activity.id}`).send({ title: "x" }).expect(403);
    await as("auth0|ana").delete(`/activities/${activity.id}`).expect(403);
  });

  it("keeps drafts hidden from members until they are published", async () => {
    const draft = await createActivity("auth0|admin", { status: "draft" });
    await as("auth0|ana").get(`/activities/${draft.id}`).expect(404);
    let list = await as("auth0|ana").get("/activities").expect(200);
    expect(list.body.activities).toHaveLength(0);
    await join("auth0|ana", draft.id).expect(404);

    const admin = await as("auth0|admin").get("/activities").expect(200);
    expect(admin.body.activities).toHaveLength(1);

    await as("auth0|admin").patch(`/activities/${draft.id}`).send({ status: "published" }).expect(200);
    list = await as("auth0|ana").get("/activities").expect(200);
    expect(list.body.activities.map((a) => a.id)).toEqual([draft.id]);
  });

  it("validates the activity", async () => {
    const res = await as("auth0|admin")
      .post("/activities")
      .send(validActivity({ participant_places: -1, category: "otra", title: " " }))
      .expect(400);
    expect(res.body.details.map((d) => d.path).sort()).toEqual(
      ["category", "participant_places", "title"].sort()
    );
    const past = await as("auth0|admin")
      .post("/activities")
      .send(validActivity({ date_time: "2020-01-01T10:00" }))
      .expect(400);
    expect(past.body.code).toBe("date_in_past");
  });

  it("lists a whole month for the calendar", async () => {
    const soon = await createActivity("auth0|admin", { date_time: daysFromNow(1) });
    await createActivity("auth0|admin", { date_time: daysFromNow(70) });
    const month = soon.date_time.slice(0, 7);

    const res = await as("auth0|ana").get(`/activities?month=${month}`).expect(200);
    expect(res.body.activities.map((a) => a.id)).toContain(soon.id);
    expect(res.body.activities.every((a) => a.date_time.startsWith(month))).toBe(true);
    await as("auth0|ana").get("/activities?month=2026-13").expect(400);
  });
});

describe("signing up", () => {
  it("puts each person in the quota for their role", async () => {
    const activity = await createActivity("auth0|admin");

    const asParticipant = await join("auth0|ana", activity.id).expect(200);
    expect(asParticipant.body.activity.my_registration).toEqual({
      quota: "participant",
      status: "confirmed",
      position: null,
    });

    const asVolunteer = await join("auth0|vera", activity.id).expect(200);
    expect(asVolunteer.body.activity).toMatchObject({
      my_registration: { quota: "volunteer", status: "confirmed" },
      participants: { confirmed: 1 },
      volunteers: { confirmed: 1 },
      going: {
        participants: [{ id: "auth0|ana", name: "Ana", photo_url: null }],
        volunteers: [{ id: "auth0|vera", name: "Vera", photo_url: null }],
      },
    });
  });

  it("uses a waiting list per quota when it is full", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await join("auth0|ana", activity.id).expect(200);

    const ben = await join("auth0|ben", activity.id).expect(200);
    expect(ben.body.activity.my_registration).toEqual({
      quota: "participant",
      status: "waiting",
      position: 1,
    });
    const cai = await join("auth0|cai", activity.id).expect(200);
    expect(cai.body.activity.my_registration.position).toBe(2);
    expect(cai.body.activity.participants).toEqual({ places: 1, confirmed: 1, waiting: 2 });

    // The volunteer quota is separate.
    const vera = await join("auth0|vera", activity.id).expect(200);
    expect(vera.body.activity.my_registration.status).toBe("confirmed");
  });

  it("gives a freed place to the first person waiting", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await join("auth0|ana", activity.id);
    await join("auth0|ben", activity.id);
    await join("auth0|cai", activity.id);

    await leave("auth0|ana", activity.id).expect(200);

    const ben = await as("auth0|ben").get(`/activities/${activity.id}`);
    expect(ben.body.activity.my_registration.status).toBe("confirmed");
    const cai = await as("auth0|cai").get(`/activities/${activity.id}`);
    expect(cai.body.activity.my_registration).toMatchObject({ status: "waiting", position: 1 });
  });

  it("moves the waiting list up when an admin adds places", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await join("auth0|ana", activity.id);
    await join("auth0|ben", activity.id);
    await join("auth0|cai", activity.id);

    const res = await as("auth0|admin")
      .patch(`/activities/${activity.id}`)
      .send({ participant_places: 2 })
      .expect(200);
    expect(res.body.activity.participants).toEqual({ places: 2, confirmed: 2, waiting: 1 });

    await as("auth0|admin")
      .patch(`/activities/${activity.id}`)
      .send({ participant_places: 1 })
      .expect(409);
  });

  it("never overbooks when people sign up at the same time", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await Promise.all(["auth0|ana", "auth0|ben", "auth0|cai"].map((u) => join(u, activity.id)));
    const { rows } = await pool.query(
      "SELECT status, count(*)::int AS n FROM registrations GROUP BY status ORDER BY status"
    );
    expect(rows).toEqual([
      { status: "confirmed", n: 1 },
      { status: "waiting", n: 2 },
    ]);
  });

  it("is harmless to sign up twice", async () => {
    const activity = await createActivity("auth0|admin");
    await join("auth0|ana", activity.id).expect(200);
    const again = await join("auth0|ana", activity.id).expect(200);
    expect(again.body.activity.participants.confirmed).toBe(1);
  });

  it("refuses sign-ups that make no sense", async () => {
    const noVolunteers = await createActivity("auth0|admin", { volunteer_places: 0 });
    const res = await join("auth0|vera", noVolunteers.id).expect(409);
    expect(res.body.code).toBe("no_places_for_role");

    await join("auth0|admin", noVolunteers.id).expect(403);

    const cancelled = await createActivity("auth0|admin", { status: "cancelled" });
    expect((await join("auth0|ana", cancelled.id).expect(409)).body.code).toBe(
      "activity_cancelled"
    );

    const past = await createActivity("auth0|admin");
    await pool.query("UPDATE activities SET date_time = now() - interval '1 hour' WHERE activity_id = $1", [past.id]);
    expect((await join("auth0|ana", past.id).expect(409)).body.code).toBe("activity_past");
  });
});

describe("Mis planes", () => {
  it("lists upcoming plans, including waiting lists and cancellations", async () => {
    const confirmed = await createActivity("auth0|admin", { date_time: daysFromNow(2) });
    const full = await createActivity("auth0|admin", { participant_places: 1, date_time: daysFromNow(3) });
    const toCancel = await createActivity("auth0|admin", { date_time: daysFromNow(4) });
    await createActivity("auth0|admin", { date_time: daysFromNow(5) });

    await join("auth0|ben", full.id);
    for (const id of [confirmed.id, full.id, toCancel.id]) await join("auth0|ana", id);
    await as("auth0|admin").patch(`/activities/${toCancel.id}`).send({ status: "cancelled" });

    const res = await as("auth0|ana").get("/users/me/activities").expect(200);
    expect(
      res.body.activities.map((a) => [a.id, a.status, a.my_registration.status])
    ).toEqual([
      [confirmed.id, "published", "confirmed"],
      [full.id, "published", "waiting"],
      [toCancel.id, "cancelled", "confirmed"],
    ]);
  });
});

describe("admin view of sign-ups", () => {
  it("lists everyone in order with contact details, and can remove someone", async () => {
    const activity = await createActivity("auth0|admin", { participant_places: 1 });
    await join("auth0|ana", activity.id);
    await join("auth0|ben", activity.id);
    await join("auth0|vera", activity.id);

    const res = await as("auth0|admin")
      .get(`/admin/activities/${activity.id}/registrations`)
      .expect(200);
    expect(res.body.registrations.map((r) => [r.name, r.quota, r.status, r.email])).toEqual([
      ["Ana", "participant", "confirmed", "Ana@example.org"],
      ["Ben", "participant", "waiting", "Ben@example.org"],
      ["Vera", "volunteer", "confirmed", "Vera@example.org"],
    ]);

    await as("auth0|admin")
      .delete(`/admin/activities/${activity.id}/registrations/auth0|ana`)
      .expect(204);
    const ben = await as("auth0|ben").get(`/activities/${activity.id}`);
    expect(ben.body.activity.my_registration.status).toBe("confirmed");

    await as("auth0|ana").get(`/admin/activities/${activity.id}/registrations`).expect(403);
  });

  it("members never see each other's email addresses", async () => {
    const activity = await createActivity("auth0|admin");
    await join("auth0|ana", activity.id);
    const res = await as("auth0|ben").get(`/activities/${activity.id}`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain("@example.org");
  });
});

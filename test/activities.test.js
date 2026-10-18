import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  as,
  createActivity,
  daysFromNow,
  registerUser,
  resetData,
  validActivity,
} from "./helpers.js";

beforeEach(async () => {
  await resetData();
  await registerUser("auth0|ana", "Ana");
  await registerUser("auth0|ben", "Ben");
  await registerUser("auth0|cai", "Cai");
});
afterAll(() => pool.end());

describe("POST /activities", () => {
  it("creates an activity with the organiser as the first attendee", async () => {
    const activity = await createActivity("auth0|ana", { date_time: daysFromNow(3, "18:30") });

    expect(activity).toMatchObject({
      title: "Ruta del Mamut",
      category: "deportes",
      type: "walk",
      max_attendees: 3,
      organiser: { id: "auth0|ana", name: "Ana", photo_url: null },
      attendee_count: 1,
      is_attending: true,
      is_organiser: true,
      attendees: [{ id: "auth0|ana", name: "Ana", photo_url: null }],
    });
    // Returned in local time with an explicit offset.
    expect(activity.date_time).toMatch(
      new RegExp(`^${daysFromNow(3, "18:30")}:00[+-]\\d{2}:\\d{2}$`)
    );
  });

  it("never exposes other members' email addresses", async () => {
    const activity = await createActivity("auth0|ana");
    const res = await as("auth0|ben").get(`/activities/${activity.id}`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain("@example.org");
  });

  it.each([
    [{ category: "otra" }, "category"],
    [{ type: "skydiving" }, "type"],
    [{ max_attendees: 0 }, "max_attendees"],
    [{ title: "   " }, "title"],
    [{ date_time: "mañana" }, "date_time"],
  ])("rejects invalid data %j", async (overrides, field) => {
    const res = await as("auth0|ana")
      .post("/activities")
      .send(validActivity(overrides))
      .expect(400);
    expect(res.body.details.map((d) => d.path)).toContain(field);
  });

  it("rejects dates in the past and impossible dates", async () => {
    const past = await as("auth0|ana")
      .post("/activities")
      .send(validActivity({ date_time: "2020-01-01T10:00" }))
      .expect(400);
    expect(past.body.code).toBe("date_in_past");

    await as("auth0|ana")
      .post("/activities")
      .send(validActivity({ date_time: "2099-02-30T10:00" }))
      .expect(400);
  });

  it("returns 400 for malformed JSON", async () => {
    await as("auth0|ana")
      .post("/activities")
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
  });
});

describe("GET /activities", () => {
  it("lists upcoming activities, filtered by category", async () => {
    const walk = await createActivity("auth0|ana", { date_time: daysFromNow(2) });
    await createActivity("auth0|ben", { category: "juegos", type: "other" });
    await pool.query(
      "UPDATE activities SET date_time = now() - interval '1 day' WHERE activity_id = $1",
      [walk.id]
    );
    const later = await createActivity("auth0|ana", { date_time: daysFromNow(9) });

    const res = await as("auth0|cai").get("/activities?category=deportes").expect(200);
    expect(res.body.activities.map((a) => a.id)).toEqual([later.id]);
    expect(res.body.activities[0]).toMatchObject({ is_attending: false, attendee_count: 1 });
  });

  it("filters by location without treating % as a wildcard", async () => {
    await createActivity("auth0|ana", { location_name: "Plaza Nueva, Granada" });
    const found = await as("auth0|ana").get("/activities?location=granada").expect(200);
    expect(found.body.activities).toHaveLength(1);
    const none = await as("auth0|ana").get("/activities?location=%25").expect(200);
    expect(none.body.activities).toHaveLength(0);
  });

  it("rejects unknown filter values", async () => {
    await as("auth0|ana").get("/activities?category=otra").expect(400);
  });
});

describe("GET /activities/:id", () => {
  it("returns 404 for unknown or invalid ids", async () => {
    await as("auth0|ana").get("/activities/999").expect(404);
    await as("auth0|ana").get("/activities/abc").expect(404);
  });
});

describe("joining and leaving", () => {
  it("lets people join until the activity is full", async () => {
    const activity = await createActivity("auth0|ana", { max_attendees: 2 });

    const joined = await as("auth0|ben")
      .put(`/activities/${activity.id}/participants/me`)
      .expect(200);
    expect(joined.body.activity).toMatchObject({ attendee_count: 2, is_attending: true });

    // Joining twice is harmless.
    await as("auth0|ben").put(`/activities/${activity.id}/participants/me`).expect(200);

    const full = await as("auth0|cai")
      .put(`/activities/${activity.id}/participants/me`)
      .expect(409);
    expect(full.body.code).toBe("activity_full");
  });

  it("never goes over capacity when people join at the same time", async () => {
    const activity = await createActivity("auth0|ana", { max_attendees: 2 });
    const results = await Promise.all(
      ["auth0|ben", "auth0|cai"].map((user) =>
        as(user).put(`/activities/${activity.id}/participants/me`)
      )
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("lets attendees leave but not the organiser", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ben").put(`/activities/${activity.id}/participants/me`).expect(200);

    const left = await as("auth0|ben")
      .delete(`/activities/${activity.id}/participants/me`)
      .expect(200);
    expect(left.body.activity).toMatchObject({ attendee_count: 1, is_attending: false });

    await as("auth0|ana").delete(`/activities/${activity.id}/participants/me`).expect(409);
  });

  it("cannot join an activity that already happened", async () => {
    const activity = await createActivity("auth0|ana");
    await pool.query(
      "UPDATE activities SET date_time = now() - interval '1 hour' WHERE activity_id = $1",
      [activity.id]
    );
    const res = await as("auth0|ben")
      .put(`/activities/${activity.id}/participants/me`)
      .expect(409);
    expect(res.body.code).toBe("activity_past");
  });
});

describe("Me gusta", () => {
  it("adds and removes interest", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ben").put(`/activities/${activity.id}/interest`).expect(204);
    await as("auth0|ben").put(`/activities/${activity.id}/interest`).expect(204);

    let res = await as("auth0|ben").get(`/activities/${activity.id}`);
    expect(res.body.activity.is_interested).toBe(true);

    await as("auth0|ben").delete(`/activities/${activity.id}/interest`).expect(204);
    res = await as("auth0|ben").get(`/activities/${activity.id}`);
    expect(res.body.activity.is_interested).toBe(false);

    await as("auth0|ben").put("/activities/999/interest").expect(404);
  });
});

describe("editing and cancelling", () => {
  it("only lets the organiser edit", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ben").patch(`/activities/${activity.id}`).send({ title: "Hack" }).expect(403);

    const res = await as("auth0|ana")
      .patch(`/activities/${activity.id}`)
      .send({ title: "Ruta corta", cost: 2.5 })
      .expect(200);
    expect(res.body.activity).toMatchObject({ title: "Ruta corta", cost: 2.5 });
  });

  it("does not reduce capacity below the people already going", async () => {
    const activity = await createActivity("auth0|ana", { max_attendees: 3 });
    await as("auth0|ben").put(`/activities/${activity.id}/participants/me`).expect(200);

    await as("auth0|ana")
      .patch(`/activities/${activity.id}`)
      .send({ max_attendees: 1 })
      .expect(409);
    await as("auth0|ana")
      .patch(`/activities/${activity.id}`)
      .send({ max_attendees: 2 })
      .expect(200);
  });

  it("rejects an empty update", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ana").patch(`/activities/${activity.id}`).send({}).expect(400);
  });

  it("only lets the organiser cancel", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ben").delete(`/activities/${activity.id}`).expect(403);
    await as("auth0|ana").delete(`/activities/${activity.id}`).expect(204);
    await as("auth0|ana").get(`/activities/${activity.id}`).expect(404);
  });
});

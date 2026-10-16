import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { app, as, createActivity, registerUser, resetData } from "./helpers.js";

beforeEach(resetData);
afterAll(() => pool.end());

describe("PUT /users/me", () => {
  it("creates the profile on first login and keeps edits on later logins", async () => {
    const first = await as("auth0|ana")
      .put("/users/me")
      .send({ name: "Ana", email: "ana@example.org" })
      .expect(201);
    expect(first.body.user).toMatchObject({ id: "auth0|ana", name: "Ana" });

    await as("auth0|ana").patch("/users/me").send({ name: "Ana María" }).expect(200);

    const again = await as("auth0|ana")
      .put("/users/me")
      .send({ name: "Ana", email: "new@example.org" })
      .expect(200);
    expect(again.body.user).toMatchObject({ name: "Ana María", email: "new@example.org" });
  });

  it("validates the body", async () => {
    const res = await as("auth0|ana").put("/users/me").send({ email: "nope" }).expect(400);
    expect(res.body.code).toBe("validation_failed");
  });
});

describe("profile", () => {
  beforeEach(() => registerUser("auth0|ana", "Ana"));

  it("returns and updates the user's own profile", async () => {
    await as("auth0|ana")
      .patch("/users/me")
      .send({ birth_year: 1990, hobbies: "Pasear y leer" })
      .expect(200);

    const res = await as("auth0|ana").get("/users/me").expect(200);
    expect(res.body.user).toEqual({
      id: "auth0|ana",
      name: "Ana",
      email: "Ana@example.org",
      photo_url: null,
      birth_year: 1990,
      hobbies: "Pasear y leer",
    });
  });

  it("only accepts https photo URLs", async () => {
    await as("auth0|ana")
      .patch("/users/me")
      .send({ photo_url: "javascript:alert(1)" })
      .expect(400);
  });

  it("deletes the account and everything that belongs to it", async () => {
    const activity = await createActivity("auth0|ana");
    await as("auth0|ana").delete("/users/me").expect(204);

    await as("auth0|ana").get("/users/me").expect(403);
    const { rowCount } = await pool.query("SELECT 1 FROM activities WHERE activity_id = $1", [
      activity.id,
    ]);
    expect(rowCount).toBe(0);
  });
});

describe("access control", () => {
  it("rejects requests without a user", async () => {
    await request(app).get("/users/me").expect(401);
    await request(app).get("/activities").expect(401);
  });

  it("asks unregistered users to create a profile first", async () => {
    const res = await as("auth0|nobody").get("/activities").expect(403);
    expect(res.body.code).toBe("registration_required");
  });

  it("has a public health check", async () => {
    await request(app).get("/health").expect(200, { status: "ok" });
  });
});

describe("my activities", () => {
  beforeEach(async () => {
    await registerUser("auth0|ana");
    await registerUser("auth0|ben");
  });

  it("lists activities I organise, attend and like", async () => {
    const mine = await createActivity("auth0|ana", { title: "Mine" });
    const bens = await createActivity("auth0|ben", { title: "Ben's" });
    const other = await createActivity("auth0|ben", { title: "Liked" });

    await as("auth0|ana").put(`/activities/${bens.id}/participants/me`).expect(200);
    await as("auth0|ana").put(`/activities/${other.id}/interest`).expect(204);

    const organiser = await as("auth0|ana").get("/users/me/activities?role=organiser");
    expect(organiser.body.activities.map((a) => a.id)).toEqual([mine.id]);

    const attending = await as("auth0|ana").get("/users/me/activities");
    expect(attending.body.activities.map((a) => a.id).sort()).toEqual([mine.id, bens.id].sort());

    const interests = await as("auth0|ana").get("/users/me/interests");
    expect(interests.body.activities.map((a) => a.id)).toEqual([other.id]);
  });
});

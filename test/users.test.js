import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { makeAdmin } from "../src/db/make-admin.js";
import { app, approvedUser, as, createActivity, registerUser, resetData, closeDatabase } from "./helpers.js";

beforeEach(resetData);
afterAll(closeDatabase);

describe("PUT /users/me", () => {
  it("creates a pending participant on first login and keeps edits on later logins", async () => {
    const first = await as("auth0|ana")
      .put("/users/me")
      .send({ name: "Ana", email: "ana@example.org" })
      .expect(201);
    expect(first.body.user).toMatchObject({
      id: "auth0|ana",
      name: "Ana",
      role: "participant",
      status: "pending",
    });

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

describe("account approval", () => {
  beforeEach(() => registerUser("auth0|ana", "Ana"));

  it("lets pending accounts see their profile but not the programme", async () => {
    const me = await as("auth0|ana").get("/users/me").expect(200);
    expect(me.body.user.status).toBe("pending");
    const res = await as("auth0|ana").get("/activities").expect(403);
    expect(res.body.code).toBe("account_pending");
    await as("auth0|ana").get("/users/me/activities").expect(403);
  });

  it("lets admins approve accounts and set roles", async () => {
    await approvedUser("auth0|admin", "admin");

    const pending = await as("auth0|admin").get("/admin/users?status=pending").expect(200);
    expect(pending.body.users.map((u) => [u.id, u.status])).toEqual([["auth0|ana", "pending"]]);

    const res = await as("auth0|admin")
      .patch("/admin/users/auth0|ana")
      .send({ role: "volunteer", status: "approved" })
      .expect(200);
    expect(res.body.user).toMatchObject({ role: "volunteer", status: "approved" });
    await as("auth0|ana").get("/activities").expect(200);

    await as("auth0|admin").patch("/admin/users/auth0|ana").send({ status: "blocked" }).expect(200);
    expect((await as("auth0|ana").get("/activities").expect(403)).body.code).toBe(
      "account_blocked"
    );
  });

  it("only admins can manage accounts, and not their own", async () => {
    await approvedUser("auth0|ben", "participant");
    await as("auth0|ben").get("/admin/users").expect(403);
    await as("auth0|ben").patch("/admin/users/auth0|ana").send({ status: "approved" }).expect(403);

    await approvedUser("auth0|admin", "admin");
    const self = await as("auth0|admin")
      .patch("/admin/users/auth0|admin")
      .send({ role: "participant" })
      .expect(409);
    expect(self.body.code).toBe("cannot_change_self");
    await as("auth0|admin").patch("/admin/users/auth0|nobody").send({ status: "approved" }).expect(404);
    await as("auth0|admin").patch("/admin/users/auth0|ana").send({ role: "boss" }).expect(400);
  });

  it("makes the first admin from the command line", async () => {
    expect(await makeAdmin("ANA@example.org")).toEqual([{ name: "Ana", email: "Ana@example.org" }]);
    await as("auth0|ana").get("/admin/users").expect(200);
    expect(await makeAdmin("nobody@example.org")).toEqual([]);
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
      role: "participant",
      status: "pending",
      email_notifications: true,
      chat_muted: false,
    });
  });

  it("lets people turn email notifications off", async () => {
    const res = await as("auth0|ana").patch("/users/me").send({ email_notifications: false }).expect(200);
    expect(res.body.user.email_notifications).toBe(false);
  });

  it("only accepts https photo URLs", async () => {
    await as("auth0|ana").patch("/users/me").send({ photo_url: "javascript:alert(1)" }).expect(400);
  });

  it("deletes the account and its sign-ups, but keeps activities an admin created", async () => {
    await approvedUser("auth0|admin", "admin");
    await approvedUser("auth0|ben", "participant");
    const activity = await createActivity("auth0|admin");
    await as("auth0|ben").put(`/activities/${activity.id}/registration`).expect(200);

    await as("auth0|ben").delete("/users/me").expect(204);
    await as("auth0|admin").delete("/users/me").expect(204);

    const { rows } = await pool.query("SELECT created_by FROM activities");
    expect(rows).toEqual([{ created_by: null }]);
    const regs = await pool.query("SELECT count(*)::int AS n FROM registrations");
    expect(regs.rows[0].n).toBe(0);
  });
});

describe("access control", () => {
  it("rejects requests without a user", async () => {
    await request(app).get("/users/me").expect(401);
    await request(app).get("/activities").expect(401);
    await request(app).get("/admin/users").expect(401);
  });

  it("asks unregistered users to create a profile first", async () => {
    const res = await as("auth0|nobody").get("/activities").expect(403);
    expect(res.body.code).toBe("registration_required");
  });

  it("has a public health check", async () => {
    await request(app).get("/health").expect(200, { status: "ok" });
  });
});

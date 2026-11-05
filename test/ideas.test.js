import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { pool } from "../src/db/pool.js";
import { app, approvedUser, as, createActivity, registerUser, resetData } from "./helpers.js";

beforeEach(async () => {
  await resetData();
  await approvedUser("auth0|admin", "admin", "Equipo");
  await approvedUser("auth0|ana", "participant", "Ana");
  await approvedUser("auth0|ben", "participant", "Ben");
  await approvedUser("auth0|vera", "volunteer", "Vera");
});
afterAll(() => pool.end());

const propose = (userId, body = { title: "Ir a un concierto" }) =>
  as(userId).post("/ideas").send(body);
const review = (id, body) => as("auth0|admin").patch(`/admin/ideas/${id}`).send(body);

describe("proposing ideas", () => {
  it("lets participants and volunteers send an idea", async () => {
    const res = await propose("auth0|ana", {
      title: "Ir a un concierto",
      description: "Me gusta la música flamenca.",
      suggested_when: "En primavera",
    }).expect(201);
    expect(res.body.idea).toMatchObject({
      title: "Ir a un concierto",
      description: "Me gusta la música flamenca.",
      suggested_when: "En primavera",
      status: "received",
      response: null,
      author: { id: "auth0|ana", name: "Ana" },
      is_mine: true,
      activity: null,
      interest_count: 0,
      image_path: null,
    });
    await propose("auth0|vera", { title: "Pasar un día en la playa" }).expect(201);
  });

  it("validates the idea and needs an approved account", async () => {
    await propose("auth0|ana", { title: "   " }).expect(400);
    await registerUser("auth0|new", "Nuevo");
    expect((await propose("auth0|new").expect(403)).body.code).toBe("account_pending");
  });

  it("lists my ideas with the team's reply", async () => {
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "declined", response: "Ahora no podemos, quizá en verano." });

    const mine = await as("auth0|ana").get("/ideas").expect(200);
    expect(mine.body.ideas.map((i) => [i.title, i.status, i.response])).toEqual([
      ["Ir a un concierto", "declined", "Ahora no podemos, quizá en verano."],
    ]);
  });
});

describe("privacy", () => {
  it("keeps new and declined ideas between the author and the team", async () => {
    const { body } = await propose("auth0|ana");
    const id = body.idea.id;

    await as("auth0|ben").get(`/ideas/${id}`).expect(404);
    let community = await as("auth0|ben").get("/ideas?scope=community").expect(200);
    expect(community.body.ideas).toEqual([]);

    await review(id, { status: "considering" }).expect(200);
    community = await as("auth0|ben").get("/ideas?scope=community").expect(200);
    expect(community.body.ideas.map((i) => i.id)).toEqual([id]);
    await as("auth0|ben").get(`/ideas/${id}`).expect(200);

    await review(id, { status: "declined" }).expect(200);
    await as("auth0|ben").get(`/ideas/${id}`).expect(404);
  });

  it("does not show my own ideas among other people's proposals", async () => {
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "considering" });
    const res = await as("auth0|ana").get("/ideas?scope=community").expect(200);
    expect(res.body.ideas).toEqual([]);
  });

  it("only shows a linked activity once it is published", async () => {
    const draft = await createActivity("auth0|admin", { status: "draft" });
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "approved", activity_id: draft.id }).expect(200);

    let mine = await as("auth0|ana").get(`/ideas/${body.idea.id}`);
    expect(mine.body.idea.activity).toBeNull();

    await as("auth0|admin").patch(`/activities/${draft.id}`).send({ status: "published" });
    mine = await as("auth0|ana").get(`/ideas/${body.idea.id}`);
    expect(mine.body.idea.activity).toEqual({ id: draft.id, title: "Cine en Granada" });
  });

  it("never shows other members' email addresses", async () => {
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "considering" });
    const res = await as("auth0|ben").get("/ideas?scope=community");
    expect(JSON.stringify(res.body)).not.toContain("@example.org");
  });
});

describe("Me gustaría participar", () => {
  it("counts people interested in a reviewed idea", async () => {
    const { body } = await propose("auth0|ana");
    const id = body.idea.id;

    const closed = await as("auth0|ben").put(`/ideas/${id}/interest`).expect(404);
    expect(closed.body.code).toBe("not_found");

    await review(id, { status: "considering" });
    const ben = await as("auth0|ben").put(`/ideas/${id}/interest`).expect(200);
    expect(ben.body.idea).toMatchObject({ interest_count: 1, i_am_interested: true });
    await as("auth0|ben").put(`/ideas/${id}/interest`).expect(200);
    const vera = await as("auth0|vera").put(`/ideas/${id}/interest`).expect(200);
    expect(vera.body.idea.interest_count).toBe(2);

    const off = await as("auth0|ben").delete(`/ideas/${id}/interest`).expect(200);
    expect(off.body.idea).toMatchObject({ interest_count: 1, i_am_interested: false });
  });

  it("puts the most wanted ideas first", async () => {
    const first = (await propose("auth0|ana", { title: "Concierto" })).body.idea.id;
    const second = (await propose("auth0|vera", { title: "Playa" })).body.idea.id;
    await review(first, { status: "considering" });
    await review(second, { status: "approved" });
    await as("auth0|ben").put(`/ideas/${second}/interest`);

    const res = await as("auth0|ben").get("/ideas?scope=community");
    expect(res.body.ideas.map((i) => i.title)).toEqual(["Playa", "Concierto"]);
  });
});

describe("the team's review", () => {
  it("lists new ideas first and lets admins filter", async () => {
    const a = (await propose("auth0|ana", { title: "A" })).body.idea.id;
    await propose("auth0|vera", { title: "B" });
    await review(a, { status: "considering" });

    const all = await as("auth0|admin").get("/admin/ideas").expect(200);
    expect(all.body.ideas.map((i) => [i.title, i.status])).toEqual([
      ["B", "received"],
      ["A", "considering"],
    ]);
    const fresh = await as("auth0|admin").get("/admin/ideas?status=received").expect(200);
    expect(fresh.body.ideas.map((i) => i.title)).toEqual(["B"]);
  });

  it("only admins review, and the activity must exist", async () => {
    const { body } = await propose("auth0|ana");
    await as("auth0|ana").patch(`/admin/ideas/${body.idea.id}`).send({ status: "approved" }).expect(403);
    await as("auth0|ana").get("/admin/ideas").expect(403);
    const res = await review(body.idea.id, { status: "approved", activity_id: 9999 }).expect(400);
    expect(res.body.code).toBe("activity_not_found");
    await review(body.idea.id, { status: "maybe" }).expect(400);
    await review(9999, { status: "approved" }).expect(404);
  });

  it("records who reviewed it", async () => {
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "considering", response: "¡Buena idea!" });
    const { rows } = await pool.query("SELECT reviewed_by, reviewed_at IS NOT NULL AS done FROM ideas");
    expect(rows).toEqual([{ reviewed_by: "auth0|admin", done: true }]);
  });
});

describe("deleting and photos", () => {
  it("lets the author or the team delete an idea, nobody else", async () => {
    const { body } = await propose("auth0|ana");
    await review(body.idea.id, { status: "considering" });
    await as("auth0|ben").delete(`/ideas/${body.idea.id}`).expect(403);
    await as("auth0|ana").delete(`/ideas/${body.idea.id}`).expect(204);
    const other = (await propose("auth0|ana")).body.idea.id;
    await as("auth0|admin").delete(`/ideas/${other}`).expect(204);
  });

  it("stores an optional photo with consent and serves it from a signed link", async () => {
    const { body } = await propose("auth0|ana");
    const id = body.idea.id;
    const photo = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#e94" } })
      .jpeg()
      .toBuffer();
    const upload = (userId, consent = true) =>
      as(userId)
        .put(`/ideas/${id}/image${consent ? "?consent=true" : ""}`)
        .set("Content-Type", "image/jpeg")
        .send(photo);

    expect((await upload("auth0|ana", false).expect(400)).body.code).toBe("consent_required");
    await upload("auth0|ben").expect(403);
    await upload("auth0|ana").expect(204);

    const { body: after } = await as("auth0|ana").get(`/ideas/${id}`);
    expect(after.idea.image_path).toMatch(new RegExp(`^/ideas/${id}/image\\?v=\\d+&expires=\\d+&sig=`));
    const image = await request(app).get(after.idea.image_path).expect(200).expect("Content-Type", "image/webp");
    expect(image.body.length).toBeGreaterThan(0);

    // An activity photo link cannot be reused for an idea.
    await request(app).get(after.idea.image_path.replace("/ideas/", "/activities/")).expect(403);

    await as("auth0|ana").delete(`/ideas/${id}/image`).expect(204);
    await request(app).get(after.idea.image_path).expect(404);
  });
});

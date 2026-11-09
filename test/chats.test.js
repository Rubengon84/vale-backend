import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { deleteOldMessages, MESSAGES_PER_MINUTE } from "../src/models/chats.js";
import { approvedUser, as, resetData, closeDatabase } from "./helpers.js";

beforeEach(async () => {
  await resetData();
  await approvedUser("auth0|admin", "admin", "Equipo");
  await approvedUser("auth0|ana", "participant", "Ana");
  await approvedUser("auth0|ben", "participant", "Ben");
  await approvedUser("auth0|vera", "volunteer", "Vera");
  for (const user of ["auth0|ana", "auth0|ben", "auth0|vera"]) {
    await as(user).post("/chats/rules").expect(200);
  }
});
afterAll(closeDatabase);

const say = (userId, room, body) => as(userId).post(`/chats/${room}/messages`).send({ body });
const read = (userId, room, query = "") => as(userId).get(`/chats/${room}/messages${query}`);

describe("rooms", () => {
  it("gives each role the right rooms", async () => {
    expect((await as("auth0|ana").get("/chats")).body.rooms).toEqual(["community", "participants"]);
    expect((await as("auth0|vera").get("/chats")).body.rooms).toEqual(["community", "volunteers"]);
    expect((await as("auth0|admin").get("/chats")).body.rooms).toEqual([
      "community",
      "participants",
      "volunteers",
    ]);
  });

  it("keeps the group rooms private", async () => {
    await say("auth0|ana", "participants", "Hola grupo").expect(201);
    await read("auth0|vera", "participants").expect(403);
    await say("auth0|vera", "participants", "Hola").expect(403);
    await read("auth0|ana", "volunteers").expect(403);
    await read("auth0|ana", "secret").expect(404);
    const admin = await read("auth0|admin", "participants").expect(200);
    expect(admin.body.messages.map((m) => m.body)).toEqual(["Hola grupo"]);
  });
});

describe("messages", () => {
  it("posts and reads messages, showing names but no emails", async () => {
    const posted = await say("auth0|ana", "community", "¿Quién viene al cine? 🎬").expect(201);
    expect(posted.body.message).toMatchObject({
      room: "community",
      body: "¿Quién viene al cine? 🎬",
      hidden: false,
      is_mine: true,
      author: { id: "auth0|ana", name: "Ana", photo_url: null },
    });
    await say("auth0|vera", "community", "¡Yo voy! 😊").expect(201);

    const res = await read("auth0|ben", "community").expect(200);
    expect(res.body.messages.map((m) => [m.author.name, m.body, m.is_mine])).toEqual([
      ["Ana", "¿Quién viene al cine? 🎬", false],
      ["Vera", "¡Yo voy! 😊", false],
    ]);
    expect(JSON.stringify(res.body)).not.toContain("@example.org");
  });

  it("returns only new messages when asked with ?after=", async () => {
    const first = (await say("auth0|ana", "community", "uno")).body.message;
    await say("auth0|ben", "community", "dos");
    const res = await read("auth0|ana", "community", `?after=${first.id}`).expect(200);
    expect(res.body.messages.map((m) => m.body)).toEqual(["dos"]);
  });

  it("validates messages and limits how fast people write", async () => {
    await say("auth0|ana", "community", "   ").expect(400);
    await say("auth0|ana", "community", "x".repeat(1001)).expect(400);
    for (let i = 0; i < MESSAGES_PER_MINUTE; i++) {
      await say("auth0|ben", "community", `mensaje ${i}`).expect(201);
    }
    expect((await say("auth0|ben", "community", "otro").expect(429)).body.code).toBe("chat_too_fast");
  });

  it("asks people to accept the rules before writing", async () => {
    await approvedUser("auth0|new", "participant", "Nuevo");
    expect((await as("auth0|new").get("/chats")).body.rules_accepted).toBe(false);
    await read("auth0|new", "community").expect(200);
    expect((await say("auth0|new", "community", "Hola").expect(403)).body.code).toBe(
      "chat_rules_required"
    );
    expect((await as("auth0|new").post("/chats/rules")).body.rules_accepted).toBe(true);
    await say("auth0|new", "community", "Hola").expect(201);
  });

  it("lets people delete their own messages only", async () => {
    const mine = (await say("auth0|ana", "community", "Ups, me equivoqué")).body.message;
    await as("auth0|ben").delete(`/chats/messages/${mine.id}`).expect(403);
    await as("auth0|ana").delete(`/chats/messages/${mine.id}`).expect(204);
    expect((await read("auth0|ben", "community")).body.messages).toEqual([]);
  });
});

describe("moderation", () => {
  it("lets people report a message once, and the team see and resolve it", async () => {
    const msg = (await say("auth0|ben", "community", "Mensaje feo")).body.message;
    await as("auth0|ben").post(`/chats/messages/${msg.id}/report`).send({}).expect(409);
    await as("auth0|ana").post(`/chats/messages/${msg.id}/report`).send({ reason: "Me molesta" }).expect(204);
    await as("auth0|ana").post(`/chats/messages/${msg.id}/report`).send({}).expect(204);
    expect((await read("auth0|ana", "community")).body.messages[0].i_reported).toBe(true);

    await as("auth0|ana").get("/admin/chat-reports").expect(403);
    const reports = await as("auth0|admin").get("/admin/chat-reports").expect(200);
    expect(reports.body.reports).toHaveLength(1);
    expect(reports.body.reports[0]).toMatchObject({
      reason: "Me molesta",
      resolved: false,
      reporter: { id: "auth0|ana", name: "Ana" },
      message: { body: "Mensaje feo", room: "community", author: { name: "Ben", muted: false } },
    });

    await as("auth0|admin").patch(`/admin/chat-reports/${reports.body.reports[0].id}`).expect(204);
    expect((await as("auth0|admin").get("/admin/chat-reports")).body.reports).toEqual([]);
    expect((await as("auth0|admin").get("/admin/chat-reports?status=all")).body.reports).toHaveLength(1);
  });

  it("hides messages from members but keeps them for the team", async () => {
    const msg = (await say("auth0|ben", "community", "Algo que no está bien")).body.message;
    await as("auth0|ana").patch(`/admin/chat-messages/${msg.id}`).send({ hidden: true }).expect(403);
    await as("auth0|admin").patch(`/admin/chat-messages/${msg.id}`).send({ hidden: true }).expect(200);

    const member = (await read("auth0|ana", "community")).body.messages[0];
    expect(member).toMatchObject({ hidden: true, body: null });
    const team = (await read("auth0|admin", "community")).body.messages[0];
    expect(team).toMatchObject({ hidden: true, body: "Algo que no está bien" });

    await as("auth0|admin").patch(`/admin/chat-messages/${msg.id}`).send({ hidden: false });
    expect((await read("auth0|ana", "community")).body.messages[0].body).toBe("Algo que no está bien");
  });

  it("lets the team pause someone's messages", async () => {
    await as("auth0|admin").patch("/admin/users/auth0|ben").send({ chat_muted: true }).expect(200);
    expect((await as("auth0|ben").get("/chats")).body.muted).toBe(true);
    expect((await say("auth0|ben", "community", "Hola").expect(403)).body.code).toBe("chat_muted");
    await read("auth0|ben", "community").expect(200);

    const res = await as("auth0|admin").patch("/admin/users/auth0|ben").send({ chat_muted: false });
    expect(res.body.user.chat_muted).toBe(false);
    await say("auth0|ben", "community", "Hola de nuevo").expect(201);
  });

  it("deletes messages older than 12 months", async () => {
    await say("auth0|ana", "community", "viejo");
    await say("auth0|ana", "community", "nuevo");
    await pool.query("UPDATE chat_messages SET created_at = now() - interval '13 months' WHERE body = 'viejo'");
    expect(await deleteOldMessages()).toBe(1);
    expect((await read("auth0|ana", "community")).body.messages.map((m) => m.body)).toEqual(["nuevo"]);
  });
});

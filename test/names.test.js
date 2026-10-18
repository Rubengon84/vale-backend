import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/pool.js";
import { safeDisplayName } from "../src/names.js";
import { as, registerUser, resetData } from "./helpers.js";

beforeEach(resetData);
afterAll(() => pool.end());

describe("safeDisplayName", () => {
  it.each([
    ["juan.perez83@hotmail.com", "Juan Perez"],
    ["MARIA_lopez@gmail.com", "Maria Lopez"],
    ["ana+vale@example.org", "Ana Vale"],
    ["12345@example.org", "Miembro"],
    ["María García", "María García"],
  ])("%s -> %s", (input, expected) => {
    expect(safeDisplayName(input)).toBe(expected);
  });
});

describe("names never reveal email addresses", () => {
  it("cleans an email used as the name when registering", async () => {
    const res = await as("auth0|juan")
      .put("/users/me")
      .send({ name: "juan.perez83@hotmail.com", email: "juan.perez83@hotmail.com" })
      .expect(201);
    expect(res.body.user).toMatchObject({ name: "Juan Perez", email: "juan.perez83@hotmail.com" });
  });

  it("rejects an email as the name when editing the profile", async () => {
    await registerUser("auth0|ana", "Ana");
    const res = await as("auth0|ana")
      .patch("/users/me")
      .send({ name: "ana@example.org" })
      .expect(400);
    expect(res.body.details[0].path).toBe("name");
  });

  it("the migration fixes names already saved as emails", async () => {
    await pool.query(
      `INSERT INTO users (user_id, name) VALUES
         ('a', 'juan.perez83@hotmail.com'), ('b', '999@x.com'), ('c', 'María García')`
    );
    const sql = await readFile(
      new URL("../src/db/migrations/003_names_without_emails.sql", import.meta.url),
      "utf8"
    );
    await pool.query(sql);
    const { rows } = await pool.query("SELECT user_id, name FROM users ORDER BY user_id");
    expect(rows.map((r) => r.name)).toEqual(["Juan Perez", "Miembro", "María García"]);
  });
});

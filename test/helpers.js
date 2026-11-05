import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { HttpError } from "../src/errors.js";
import { flushBackground } from "../src/background.js";

// Stands in for Auth0: the user id comes from a test-only header.
function fakeAuth(req, res, next) {
  const sub = req.get("x-test-user");
  if (!sub) {
    return next(new HttpError(401, "Unauthorized", "unauthorized"));
  }
  req.auth = { payload: { sub } };
  next();
}

export const app = createApp({ authenticate: fakeAuth });

export function as(userId) {
  const agent = request(app);
  const withUser = (method) => (url) => agent[method](url).set("x-test-user", userId);
  return {
    get: withUser("get"),
    post: withUser("post"),
    put: withUser("put"),
    patch: withUser("patch"),
    delete: withUser("delete"),
  };
}

export async function resetData() {
  await pool.query("TRUNCATE users, activities, registrations, ideas, chat_messages RESTART IDENTITY CASCADE");
}

export async function registerUser(userId, name = userId) {
  await as(userId).put("/users/me").send({ name, email: `${name.replace(/\W/g, "")}@example.org` }).expect(201);
}

// Creates an approved account directly, as an admin would.
export async function approvedUser(userId, role = "participant", name = userId) {
  await registerUser(userId, name);
  await pool.query("UPDATE users SET role = $2, status = 'approved' WHERE user_id = $1", [
    userId,
    role,
  ]);
}

// A date-time string a given number of days from now, in local time.
export function daysFromNow(days, time = "18:00") {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

export const validActivity = (overrides = {}) => ({
  title: "Cine en Granada",
  category: "culturales",
  description: "Vamos juntos al cine.",
  date_time: daysFromNow(7, "17:00"),
  location_name: "Cines Kinépolis",
  meeting_point: "Puerta del cine",
  transport: "Autobús 9",
  price: 6,
  participant_places: 2,
  volunteer_places: 1,
  status: "published",
  ...overrides,
});

// Created by an admin (the account must exist and be an admin).
export async function createActivity(adminId, overrides) {
  const res = await as(adminId).post("/activities").send(validActivity(overrides)).expect(201);
  return res.body.activity;
}

// Waits for background work (emails) before closing the database.
export async function closeDatabase() {
  await flushBackground();
  await pool.end();
}

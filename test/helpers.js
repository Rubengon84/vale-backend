import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { HttpError } from "../src/errors.js";

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
  await pool.query("TRUNCATE users, activities, attendees, interests RESTART IDENTITY CASCADE");
}

export async function registerUser(userId, name = userId) {
  await as(userId).put("/users/me").send({ name, email: `${name.replace(/\W/g, "")}@example.org` }).expect(201);
}

// A date-time string a given number of days from now, in local time.
export function daysFromNow(days, time = "18:00") {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

export const validActivity = (overrides = {}) => ({
  title: "Ruta del Mamut",
  category: "deportes",
  type: "walk",
  location_name: "Plaza Nueva, Granada",
  date_time: daysFromNow(7, "10:00"),
  description: "Ruta fácil por el campo.",
  max_attendees: 3,
  ...overrides,
});

export async function createActivity(userId, overrides) {
  const res = await as(userId).post("/activities").send(validActivity(overrides)).expect(201);
  return res.body.activity;
}

import { afterAll, describe, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

// Uses the real Auth0 middleware; these cases are rejected before any network call.
const app = createApp();
afterAll(() => pool.end());

describe("Auth0 token check", () => {
  it("rejects requests without a token", async () => {
    await request(app).get("/activities").expect(401, { error: "Unauthorized" });
  });

  it("rejects a malformed token", async () => {
    await request(app)
      .get("/activities")
      .set("Authorization", "Bearer not-a-jwt")
      .expect(401);
  });

  it("no longer accepts a raw user id as the Authorization header", async () => {
    // Not a "Bearer" header at all, so it is an invalid request (RFC 6750).
    await request(app).get("/users/me").set("Authorization", "auth0|someone").expect(400);
  });
});

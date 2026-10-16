import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { pool } from "../src/db/pool.js";
import { imagePath } from "../src/images.js";
import { app, as, createActivity, registerUser, resetData } from "./helpers.js";

beforeEach(async () => {
  await resetData();
  await registerUser("auth0|ana", "Ana");
  await registerUser("auth0|ben", "Ben");
});
afterAll(() => pool.end());

// A large phone-like JPEG carrying GPS data in its EXIF metadata.
const phonePhoto = () =>
  sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#3a7" } })
    .withExif({ IFD0: { Make: "PhoneMaker", Copyright: "secret-home-address" } })
    .jpeg({ quality: 95 })
    .toBuffer();

const upload = (userId, activityId, body, { consent = true, type = "image/jpeg" } = {}) =>
  as(userId)
    .put(`/activities/${activityId}/image${consent ? "?consent=true" : ""}`)
    .set("Content-Type", type)
    .send(body);

describe("activity photos", () => {
  it("stores a shrunken WebP without metadata and serves it from a signed link", async () => {
    const activity = await createActivity("auth0|ana");
    expect(activity.image_path).toBeNull();

    await upload("auth0|ana", activity.id, await phonePhoto()).expect(204);

    const { body } = await as("auth0|ben").get(`/activities/${activity.id}`).expect(200);
    expect(body.activity.image_path).toMatch(
      new RegExp(`^/activities/${activity.id}/image\\?v=\\d+&expires=\\d+&sig=[\\w-]+$`)
    );

    // No login needed: the signature is the permission.
    const image = await request(app)
      .get(body.activity.image_path)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect("Content-Type", "image/webp")
      .expect("Cross-Origin-Resource-Policy", "cross-origin");

    const metadata = await sharp(image.body).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1280, height: 960 });
    expect(metadata.exif).toBeUndefined();
    expect(image.body.length).toBeLessThan(100_000);
    expect(image.body.toString("latin1")).not.toContain("secret-home-address");

    const { rows } = await pool.query(
      "SELECT consent_confirmed_at IS NOT NULL AS consent FROM activity_images"
    );
    expect(rows).toEqual([{ consent: true }]);
  });

  it("shows the photo in activity lists too", async () => {
    const activity = await createActivity("auth0|ana");
    await upload("auth0|ana", activity.id, await phonePhoto()).expect(204);
    const { body } = await as("auth0|ben").get("/activities").expect(200);
    expect(body.activities[0].image_path).toContain(`/activities/${activity.id}/image`);
  });

  it("requires the consent confirmation", async () => {
    const activity = await createActivity("auth0|ana");
    const res = await upload("auth0|ana", activity.id, await phonePhoto(), { consent: false })
      .expect(400);
    expect(res.body.code).toBe("consent_required");
  });

  it("only lets the organiser add or remove the photo", async () => {
    const activity = await createActivity("auth0|ana");
    await upload("auth0|ben", activity.id, await phonePhoto()).expect(403);
    await as("auth0|ben").delete(`/activities/${activity.id}/image`).expect(403);
    await upload("auth0|ben", 999, await phonePhoto()).expect(404);
  });

  it("rejects files that are not images", async () => {
    const activity = await createActivity("auth0|ana");
    const fake = await upload("auth0|ana", activity.id, Buffer.from("<script>hi</script>"))
      .expect(400);
    expect(fake.body.code).toBe("invalid_image");

    await as("auth0|ana")
      .put(`/activities/${activity.id}/image?consent=true`)
      .set("Content-Type", "text/plain")
      .send("hello")
      .expect(415);
  });

  it("rejects uploads over 5 MB", async () => {
    const activity = await createActivity("auth0|ana");
    await upload("auth0|ana", activity.id, Buffer.alloc(6 * 1024 * 1024)).expect(413);
  });

  it("refuses tampered, expired or outdated links", async () => {
    const activity = await createActivity("auth0|ana");
    await upload("auth0|ana", activity.id, await phonePhoto()).expect(204);
    const { body } = await as("auth0|ana").get(`/activities/${activity.id}`);
    const link = body.activity.image_path;

    await request(app).get(link.replace(/sig=.{4}/, "sig=AAAA")).expect(403);
    await request(app).get(`/activities/${activity.id}/image`).expect(403);

    const version = new URL(link, "http://x").searchParams.get("v");
    const expired = imagePath(activity.id, version, Date.now() - 7 * 3600 * 1000);
    await request(app).get(expired).expect(403);

    // Replacing the photo invalidates links to the old one.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await upload("auth0|ana", activity.id, await phonePhoto()).expect(204);
    await request(app).get(link).expect(404);
  });

  it("removes the photo", async () => {
    const activity = await createActivity("auth0|ana");
    await upload("auth0|ana", activity.id, await phonePhoto()).expect(204);
    const { body } = await as("auth0|ana").get(`/activities/${activity.id}`);

    await as("auth0|ana").delete(`/activities/${activity.id}/image`).expect(204);
    await request(app).get(body.activity.image_path).expect(404);
    const after = await as("auth0|ana").get(`/activities/${activity.id}`);
    expect(after.body.activity.image_path).toBeNull();
  });
});

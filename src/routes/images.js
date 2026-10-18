import express, { Router } from "express";
import { HttpError, notFound } from "../errors.js";
import { MAX_UPLOAD_BYTES, processImage, verifyImageLink } from "../images.js";
import * as images from "../models/images.js";
import { idParam } from "../schemas.js";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];

function activityId(req) {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) {
    throw notFound("Activity");
  }
  return parsed.data.id;
}

// Public: the signed link is the permission (see imagePath in src/images.js).
export const publicImagesRouter = Router();

publicImagesRouter.get("/:id/image", async (req, res) => {
  const id = activityId(req);
  if (!verifyImageLink(id, req.query)) {
    throw new HttpError(403, "This photo link is not valid or has expired", "invalid_link");
  }
  const data = await images.getActivityImage(id, req.query.v);
  if (!data) {
    throw notFound("Photo");
  }

  const secondsLeft = Math.max(0, Number(req.query.expires) - Math.floor(Date.now() / 1000));
  res.set({
    "Content-Type": "image/webp",
    "Cache-Control": `private, max-age=${secondsLeft}, immutable`,
    // Let the front end (a different origin) show the image.
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.send(data);
});

// Behind login: only the organiser can add, replace or remove the photo.
export const imagesRouter = Router();

imagesRouter.put(
  "/:id/image",
  express.raw({ type: IMAGE_TYPES, limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    const id = activityId(req);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(
        415,
        `Send the photo as the request body with Content-Type ${IMAGE_TYPES.join(", ")}`,
        "unsupported_media_type"
      );
    }
    if (req.query.consent !== "true") {
      throw new HttpError(
        400,
        "Confirm that the people in the photo agree to it being published",
        "consent_required"
      );
    }
    await images.saveActivityImage(req.userId, id, await processImage(req.body));
    res.status(204).end();
  }
);

imagesRouter.delete("/:id/image", async (req, res) => {
  await images.deleteActivityImage(req.userId, activityId(req));
  res.status(204).end();
});

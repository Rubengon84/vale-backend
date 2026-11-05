import express, { Router } from "express";
import { HttpError, notFound } from "../errors.js";
import { MAX_UPLOAD_BYTES, processImage, verifyImageLink } from "../images.js";
import * as images from "../models/images.js";
import { requireAdmin } from "../middleware/auth.js";
import { idParam } from "../schemas.js";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];

export function parseId(req, what) {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) {
    throw notFound(what);
  }
  return parsed.data.id;
}

// GET /:id/image, public: the signed link is the permission (see src/images.js).
export function publicImageRouter(kind, getImage) {
  const router = Router();
  router.get("/:id/image", async (req, res) => {
    const id = parseId(req, "Photo");
    if (!verifyImageLink(kind, id, req.query)) {
      throw new HttpError(403, "This photo link is not valid or has expired", "invalid_link");
    }
    const data = await getImage(id, req.query.v);
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
  return router;
}

// Reads a raw image body, checks consent and re-encodes it.
// Calls save(req, id, image) when everything is valid.
export function imageUploadHandlers(what, save) {
  return [
    express.raw({ type: IMAGE_TYPES, limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const id = parseId(req, what);
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
      await save(req, id, await processImage(req.body));
      res.status(204).end();
    },
  ];
}

export const publicActivityImagesRouter = publicImageRouter(
  "activities",
  images.getActivityImage
);

// Behind login: only the VALE team can add, replace or remove activity photos.
export const imagesRouter = Router();

imagesRouter.put(
  "/:id/image",
  requireAdmin,
  ...imageUploadHandlers("Activity", (req, id, image) => images.saveActivityImage(id, image))
);

imagesRouter.delete("/:id/image", requireAdmin, async (req, res) => {
  await images.deleteActivityImage(parseId(req, "Activity"));
  res.status(204).end();
});

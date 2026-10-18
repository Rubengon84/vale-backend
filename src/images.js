import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { config } from "./config.js";
import { HttpError } from "./errors.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 1280;
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif"]);

// Never trust the client's compression: decode, auto-rotate, shrink and
// re-encode every upload as WebP. sharp drops all metadata (EXIF, GPS) by default.
export async function processImage(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new HttpError(400, "The file is not a valid image", "invalid_image");
  }
  if (!ACCEPTED_FORMATS.has(metadata.format)) {
    throw new HttpError(400, "Use a JPEG, PNG, WebP or HEIC photo", "invalid_image");
  }

  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new HttpError(400, "The file is not a valid image", "invalid_image");
  }
}

// Photos are shown with plain <img> tags, which cannot send the login token,
// so the API hands out signed links that stop working after a few hours.
let secret = config.imageUrlSecret;
if (!secret) {
  if (config.env === "production") {
    throw new Error("Missing configuration: IMAGE_URL_SECRET");
  }
  // Fine for development: links just stop working when the server restarts.
  secret = randomBytes(32).toString("hex");
}

const LINK_WINDOW_SECONDS = 3 * 60 * 60;

const sign = (activityId, version, expires) =>
  createHmac("sha256", secret).update(`${activityId}:${version}:${expires}`).digest("base64url");

// Links expire at the end of the next 3-hour window, so the same link (and the
// browser's cached copy) is reused for a while.
export function imagePath(activityId, version, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000);
  const expires =
    (Math.floor(nowSeconds / LINK_WINDOW_SECONDS) + 2) * LINK_WINDOW_SECONDS;
  const signature = sign(activityId, version, expires);
  return `/activities/${activityId}/image?v=${version}&expires=${expires}&sig=${signature}`;
}

export function verifyImageLink(activityId, { v, expires, sig }, now = Date.now()) {
  if (!v || !expires || !sig || Number(expires) * 1000 < now) {
    return false;
  }
  const expected = Buffer.from(sign(activityId, v, expires));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

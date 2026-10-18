import { auth } from "express-oauth2-jwt-bearer";
import { config, assertConfig } from "../config.js";
import { query } from "../db/pool.js";
import { HttpError } from "../errors.js";

// Verifies the Auth0 access token (signature, issuer, audience, expiry).
export function jwtAuth() {
  assertConfig("auth0.domain", "auth0.audience");
  return auth({
    issuerBaseURL: `https://${config.auth0.domain}/`,
    audience: config.auth0.audience,
    tokenSigningAlg: "RS256",
  });
}

// The user id always comes from the verified token, never from the request.
export function currentUser(req, res, next) {
  const sub = req.auth?.payload?.sub;
  if (!sub) {
    return next(new HttpError(401, "Unauthorized", "unauthorized"));
  }
  req.userId = sub;
  next();
}

// Most endpoints need a profile row; the front end creates it with PUT /users/me.
export async function requireRegisteredUser(req, res, next) {
  const { rowCount } = await query("SELECT 1 FROM users WHERE user_id = $1", [req.userId]);
  if (rowCount === 0) {
    return next(
      new HttpError(403, "Create your profile first with PUT /users/me", "registration_required")
    );
  }
  next();
}

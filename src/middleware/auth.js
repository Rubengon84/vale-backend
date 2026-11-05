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

// Loads the member's role and account status. Every endpoint except
// PUT /users/me needs a profile; the front end creates it after login.
export async function loadUser(req, res, next) {
  const { rows } = await query("SELECT role, status FROM users WHERE user_id = $1", [req.userId]);
  if (rows.length === 0) {
    return next(
      new HttpError(403, "Create your profile first with PUT /users/me", "registration_required")
    );
  }
  req.user = { id: req.userId, ...rows[0] };
  next();
}

// New accounts wait until an admin approves them and gives them a role.
export function requireApproved(req, res, next) {
  if (req.user.status === "pending") {
    return next(new HttpError(403, "Your account is waiting for approval", "account_pending"));
  }
  if (req.user.status === "blocked") {
    return next(new HttpError(403, "Your account is blocked", "account_blocked"));
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return next(new HttpError(403, "Only the VALE team can do this", "admin_only"));
  }
  next();
}

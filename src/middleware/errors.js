import { ZodError } from "zod";
import { HttpError } from "../errors.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found", code: "not_found" });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Invalid request",
      code: "validation_failed",
      details: err.issues.map(({ path, message }) => ({ path: path.join("."), message })),
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Postgres "data exception" errors, e.g. an impossible date like 2026-02-30.
  if (typeof err.code === "string" && err.code.startsWith("22")) {
    return res.status(400).json({ error: "Invalid value", code: "invalid_value" });
  }

  // Errors from Auth0 token checks and body parsing carry a 4xx status.
  if (err.status >= 400 && err.status < 500) {
    const message = err.status === 401 ? "Unauthorized" : err.expose ? err.message : "Bad request";
    return res.status(err.status).json({ error: message });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

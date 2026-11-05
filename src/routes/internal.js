import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { notFound } from "../errors.js";
import { runJobs } from "../jobs.js";

// For an external timer (e.g. cron-job.org) that calls this every hour. It
// also wakes the server up on hosting plans that sleep.
const router = Router();

function authorised(req) {
  if (!config.cronSecret) return false;
  const expected = Buffer.from(`Bearer ${config.cronSecret}`);
  const given = Buffer.from(req.get("authorization") ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

router.post("/jobs", async (req, res) => {
  if (!authorised(req)) {
    throw notFound();
  }
  res.json(await runJobs());
});

export default router;

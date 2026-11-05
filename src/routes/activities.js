import { Router } from "express";
import * as activities from "../models/activities.js";
import { requireAdmin } from "../middleware/auth.js";
import { activityFilters, createActivityBody, idParam, updateActivityBody } from "../schemas.js";
import { notFound } from "../errors.js";

const router = Router();

// Invalid ids (e.g. /activities/abc) are treated as "not found".
router.param("id", (req, res, next, value) => {
  const parsed = idParam.safeParse({ id: value });
  if (!parsed.success) {
    return next(notFound("Activity"));
  }
  req.activityId = parsed.data.id;
  next();
});

router.get("/", async (req, res) => {
  const filters = activityFilters.parse(req.query);
  res.json({ activities: await activities.listActivities(req.user, filters) });
});

router.get("/:id", async (req, res) => {
  res.json({ activity: await activities.getActivity(req.user, req.activityId) });
});

// Sign up (or join the waiting list) in the quota that matches your role.
router.put("/:id/registration", async (req, res) => {
  res.json({ activity: await activities.register(req.user, req.activityId) });
});

router.delete("/:id/registration", async (req, res) => {
  res.json({ activity: await activities.unregister(req.user, req.activityId) });
});

// The programme is managed by the VALE team.
router.post("/", requireAdmin, async (req, res) => {
  const data = createActivityBody.parse(req.body);
  res.status(201).json({ activity: await activities.createActivity(req.user, data) });
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const changes = updateActivityBody.parse(req.body);
  res.json({ activity: await activities.updateActivity(req.user, req.activityId, changes) });
});

router.delete("/:id", requireAdmin, async (req, res) => {
  await activities.deleteActivity(req.activityId);
  res.status(204).end();
});

export default router;

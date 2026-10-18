import { Router } from "express";
import * as activities from "../models/activities.js";
import {
  activityFilters,
  createActivityBody,
  idParam,
  updateActivityBody,
} from "../schemas.js";
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
  res.json({ activities: await activities.listActivities(req.userId, filters) });
});

router.post("/", async (req, res) => {
  const data = createActivityBody.parse(req.body);
  res.status(201).json({ activity: await activities.createActivity(req.userId, data) });
});

router.get("/:id", async (req, res) => {
  res.json({ activity: await activities.getActivity(req.userId, req.activityId) });
});

router.patch("/:id", async (req, res) => {
  const changes = updateActivityBody.parse(req.body);
  res.json({
    activity: await activities.updateActivity(req.userId, req.activityId, changes),
  });
});

router.delete("/:id", async (req, res) => {
  await activities.deleteActivity(req.userId, req.activityId);
  res.status(204).end();
});

router.put("/:id/participants/me", async (req, res) => {
  res.json({ activity: await activities.joinActivity(req.userId, req.activityId) });
});

router.delete("/:id/participants/me", async (req, res) => {
  res.json({ activity: await activities.leaveActivity(req.userId, req.activityId) });
});

router.put("/:id/interest", async (req, res) => {
  await activities.setInterest(req.userId, req.activityId, true);
  res.status(204).end();
});

router.delete("/:id/interest", async (req, res) => {
  await activities.setInterest(req.userId, req.activityId, false);
  res.status(204).end();
});

export default router;

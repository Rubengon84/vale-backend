import { Router } from "express";
import * as users from "../models/users.js";
import { listInterests, listMyActivities } from "../models/activities.js";
import { requireRegisteredUser } from "../middleware/auth.js";
import { myActivitiesQuery, registerUserBody, updateUserBody } from "../schemas.js";

const router = Router();

// Called by the front end after every login.
router.put("/me", async (req, res) => {
  const data = registerUserBody.parse(req.body);
  const { user, created } = await users.registerUser(req.userId, data);
  res.status(created ? 201 : 200).json({ user });
});

router.use(requireRegisteredUser);

router.get("/me", async (req, res) => {
  res.json({ user: await users.getUser(req.userId) });
});

router.patch("/me", async (req, res) => {
  const changes = updateUserBody.parse(req.body);
  res.json({ user: await users.updateUser(req.userId, changes) });
});

router.delete("/me", async (req, res) => {
  await users.deleteUser(req.userId);
  res.status(204).end();
});

router.get("/me/activities", async (req, res) => {
  const { role } = myActivitiesQuery.parse(req.query);
  res.json({ activities: await listMyActivities(req.userId, role) });
});

router.get("/me/interests", async (req, res) => {
  res.json({ activities: await listInterests(req.userId) });
});

export default router;

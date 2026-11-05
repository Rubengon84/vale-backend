import { Router } from "express";
import * as users from "../models/users.js";
import { listMyPlans } from "../models/activities.js";
import { loadUser, requireApproved } from "../middleware/auth.js";
import { registerUserBody, updateUserBody } from "../schemas.js";

const router = Router();

// Called by the front end after every login. New accounts start as
// participants waiting for approval.
router.put("/me", async (req, res) => {
  const data = registerUserBody.parse(req.body);
  const { user, created } = await users.registerUser(req.userId, data);
  res.status(created ? 201 : 200).json({ user });
});

router.use(loadUser);

// Available while the account is pending, so people can see their status,
// edit their details or delete their account.
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

// "Mis planes"
router.get("/me/activities", requireApproved, async (req, res) => {
  res.json({ activities: await listMyPlans(req.user) });
});

export default router;

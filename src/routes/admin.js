import { Router } from "express";
import * as users from "../models/users.js";
import * as activities from "../models/activities.js";
import { adminUserUpdateBody, adminUsersQuery, idParam, userIdParam } from "../schemas.js";

// Everything here requires an approved admin (see app.js).
const router = Router();

router.get("/users", async (req, res) => {
  const filters = adminUsersQuery.parse(req.query);
  res.json({ users: await users.listUsers(filters) });
});

// Approve or block an account, and set its role.
router.patch("/users/:userId", async (req, res) => {
  const { userId } = userIdParam.parse(req.params);
  const changes = adminUserUpdateBody.parse(req.body);
  res.json({ user: await users.updateUserAccess(req.user, userId, changes) });
});

router.get("/activities/:id/registrations", async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json({ registrations: await activities.listRegistrations(id) });
});

router.delete("/activities/:id/registrations/:userId", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { userId } = userIdParam.parse(req.params);
  await activities.removeRegistrationByAdmin(id, userId);
  res.status(204).end();
});

export default router;

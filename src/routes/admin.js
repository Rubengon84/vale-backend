import { Router } from "express";
import * as users from "../models/users.js";
import * as activities from "../models/activities.js";
import * as ideas from "../models/ideas.js";
import * as chats from "../models/chats.js";
import {
  chatMessageUpdateBody,
  chatReportsQuery,
  adminIdeasQuery,
  adminUserUpdateBody,
  adminUsersQuery,
  idParam,
  reviewIdeaBody,
  userIdParam,
} from "../schemas.js";

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

// Ideas inbox: new ideas first.
router.get("/ideas", async (req, res) => {
  const filters = adminIdeasQuery.parse(req.query);
  res.json({ ideas: await ideas.listIdeasForAdmin(req.user, filters) });
});

// Review an idea: status, a reply for the author, and the resulting activity.
router.patch("/ideas/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const changes = reviewIdeaBody.parse(req.body);
  res.json({ idea: await ideas.reviewIdea(req.user, id, changes) });
});

// Chat moderation
router.get("/chat-reports", async (req, res) => {
  const filters = chatReportsQuery.parse(req.query);
  res.json({ reports: await chats.listReports(filters) });
});

router.patch("/chat-reports/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  await chats.resolveReport(req.user, id);
  res.status(204).end();
});

router.patch("/chat-messages/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { hidden } = chatMessageUpdateBody.parse(req.body);
  res.json({ message: await chats.setMessageHidden(req.user, id, hidden) });
});

export default router;

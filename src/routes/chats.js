import { Router } from "express";
import * as chats from "../models/chats.js";
import { chatMessageBody, chatMessagesQuery, chatReportBody, chatRoomParam } from "../schemas.js";
import { parseId } from "./images.js";

const router = Router();

// Rooms I can use, and whether I accepted the rules or am paused.
router.get("/", async (req, res) => {
  res.json(await chats.getChatOverview(req.user));
});

router.post("/rules", async (req, res) => {
  res.json(await chats.acceptRules(req.user));
});

router.get("/:room/messages", async (req, res) => {
  const { room } = chatRoomParam.parse(req.params);
  const filters = chatMessagesQuery.parse(req.query);
  res.json({ messages: await chats.listMessages(req.user, room, filters) });
});

router.post("/:room/messages", async (req, res) => {
  const { room } = chatRoomParam.parse(req.params);
  const { body } = chatMessageBody.parse(req.body);
  res.status(201).json({ message: await chats.postMessage(req.user, room, body) });
});

router.delete("/messages/:id", async (req, res) => {
  await chats.deleteOwnMessage(req.user, parseId(req, "Message"));
  res.status(204).end();
});

router.post("/messages/:id/report", async (req, res) => {
  const { reason } = chatReportBody.parse(req.body ?? {});
  await chats.reportMessage(req.user, parseId(req, "Message"), reason);
  res.status(204).end();
});

export default router;

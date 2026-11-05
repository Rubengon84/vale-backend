import { Router } from "express";
import * as ideas from "../models/ideas.js";
import { createIdeaBody, ideaListQuery } from "../schemas.js";
import { imageUploadHandlers, parseId, publicImageRouter } from "./images.js";

export const publicIdeaImagesRouter = publicImageRouter("ideas", ideas.getIdeaImage);

const router = Router();

// ?scope=mine (default): my ideas, with the team's reply.
// ?scope=community: reviewed ideas from other people ("Otras propuestas").
router.get("/", async (req, res) => {
  const { scope } = ideaListQuery.parse(req.query);
  const list =
    scope === "community"
      ? await ideas.listCommunityIdeas(req.user)
      : await ideas.listMyIdeas(req.user);
  res.json({ ideas: list });
});

router.post("/", async (req, res) => {
  const data = createIdeaBody.parse(req.body);
  res.status(201).json({ idea: await ideas.createIdea(req.user, data) });
});

router.get("/:id", async (req, res) => {
  res.json({ idea: await ideas.getIdea(req.user, parseId(req, "Idea")) });
});

router.delete("/:id", async (req, res) => {
  await ideas.deleteIdea(req.user, parseId(req, "Idea"));
  res.status(204).end();
});

// "Me gustaría participar"
router.put("/:id/interest", async (req, res) => {
  res.json({ idea: await ideas.setInterest(req.user, parseId(req, "Idea"), true) });
});

router.delete("/:id/interest", async (req, res) => {
  res.json({ idea: await ideas.setInterest(req.user, parseId(req, "Idea"), false) });
});

// Optional photo: the author (or the team), with consent.
router.put(
  "/:id/image",
  ...imageUploadHandlers("Idea", (req, id, image) => ideas.saveIdeaImage(req.user, id, image))
);

router.delete("/:id/image", async (req, res) => {
  await ideas.deleteIdeaImage(req.user, parseId(req, "Idea"));
  res.status(204).end();
});

export default router;

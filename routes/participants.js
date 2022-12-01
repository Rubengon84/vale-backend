import express from "express";
import { upsertParticipantsRow, getActivitiesByRole } from "../models/participants";

const router =  express.Router();

router.get("/", async function (req, res, next) {
  const user_id = req.headers.authorization;
  if (user_id) {
    try {
      const participant_role = req.params.participant_role;
      const activities = await getActivitiesByRole(
        user_id,
        participant_role,
      );

      res.json({
        success: true,
        payload: activities,
      })
    } catch (error) {
      next(error);
    }
  } else {
    res.json({ success: false, message: "Missing authorization header"});
  }
});

router.put("/", async function (req, res, next) {
  const user_id = req.headers.authorization;
  if(user_id) {
    try {
      const activity_id = req.body.activity_id;
      const participant_role = req.body.participant_role;
      const users = await upsertParticipantsRow(
        user_id,
        activity_id,
        participant_role
      );

      res.json({
        success: true,
        payload: users,
      });
    } catch (error) {
      next(error);
    }
  } else {
    res.json({ success: false, message: "Missing authorization header"});
  }
})

export default router;
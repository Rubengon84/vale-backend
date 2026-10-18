import { Router } from "express";
import { query } from "../db/pool.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

export default router;

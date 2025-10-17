import express from "express";
import { parsePromptToActions } from "../services/aiPromptService.js";

const router = express.Router();

/**
 * POST /api/ai/interpret
 * Body: { "prompt": "make the roof matte black and add blue underglow" }
 */
router.post("/interpret", async (req, res) => {
  try {
    const { prompt, carContext } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ success: false, error: "Prompt is required." });
    }

    const actions = await parsePromptToActions(prompt, carContext || {});
    console.log("🎯 AI Actions:", actions);

    res.json({
      success: true,
      actions,
    });
  } catch (err) {
    console.error("❌ AI Route Error:", err);
    res.status(500).json({
      success: false,
      error: err.message || "AI interpretation failed",
    });
  }
});

export default router;

import express from "express";
import { generatePartGLB } from "../services/partBuilderService.js";
const router = express.Router();

// Create a new 3D part dynamically
router.post("/create", async (req, res) => {
  try {
    const { prompt, carContext } = req.body;
    const glbBuffer = await generatePartGLB(prompt, carContext);
    res.setHeader("Content-Type", "model/gltf-binary");
    res.send(glbBuffer);
  } catch (err) {
    console.error("Part generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

import { generatePartGLB } from "../services/partBuilderService.js";

import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

/**
 * POST /api/part/create
 * Returns a 3D GLB file (used by AIChatBox for new parts)
 */
router.post("/create", async (req, res) => {
  try {
    console.log("🧱 Received part creation request:", req.body);

    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Point to your placeholder GLB inside carmod-backend
    const filePath = path.join(process.cwd(), "carmod-backend", "sample_parts", "placeholder.glb");

    if (!fs.existsSync(filePath)) {
      console.warn("⚠️ No placeholder.glb found, sending dummy data");
      const dummyBuffer = Buffer.from("glTF");
      res.setHeader("Content-Type", "model/gltf-binary");
      return res.send(dummyBuffer);
    }

    const glbBuffer = fs.readFileSync(filePath);
    res.setHeader("Content-Type", "model/gltf-binary");
    res.send(glbBuffer);
  } catch (err) {
    console.error("❌ Part generation error:", err);
    res.status(500).json({ error: err.message || "Failed to create part" });
  }
});

export default router;

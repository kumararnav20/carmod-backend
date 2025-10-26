import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * POST /api/part/create
 * Returns a placeholder GLB (used by AIChatBox)
 */
router.post("/create", async (req, res) => {
  try {
    console.log("🧱 Received part creation request:", req.body);

    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // ✅ Correct absolute path for Render
    const filePath = path.join(__dirname, "..", "sample_parts", "placeholder.glb");

    console.log("🔍 Checking placeholder path:", filePath);

    if (!fs.existsSync(filePath)) {
      console.warn("⚠️ No placeholder.glb found, sending dummy data");
      const dummyBuffer = Buffer.from("glTF");
      res.setHeader("Content-Type", "model/gltf-binary");
      return res.send(dummyBuffer);
    }

    // ✅ Read real GLB and send it
    const glbBuffer = fs.readFileSync(filePath);
    console.log("✅ Loaded placeholder.glb successfully, size:", glbBuffer.length);

    res.setHeader("Content-Type", "model/gltf-binary");
    res.send(glbBuffer);
  } catch (err) {
    console.error("❌ Part generation error:", err);
    res.status(500).json({ error: err.message || "Failed to create part" });
  }
});

export default router;

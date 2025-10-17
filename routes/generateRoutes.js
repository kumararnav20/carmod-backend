// routes/generateRoutes.js
import express from "express";
import multer from "multer";
import { imageToGlb } from "../services/imageToGlbService.js";

const router = express.Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB photo

// POST /api/generate/image-to-glb
//  body: form-data => image: <file>
router.post("/image-to-glb", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, error:"No image uploaded" });

    const glb = await imageToGlb(req.file.buffer);

    // Send back as file download
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Content-Disposition", `attachment; filename="generated_${Date.now()}.glb"`);
    return res.send(glb);
  } catch (err) {
    console.error("image-to-glb error:", err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;

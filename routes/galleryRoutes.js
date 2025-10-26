import express from "express";
import { Storage } from "@google-cloud/storage";

const router = express.Router();

// 🔹 Replace with your actual bucket name
const BUCKET_NAME = "carmod-glb";

// Initialize GCS
const storage = new Storage({
  // This will automatically read GOOGLE_APPLICATION_CREDENTIALS from .env
});

router.get("/", async (req, res) => {
  try {
    // ✅ Get all files at root level (no subfolders)
    const [files] = await storage.bucket(BUCKET_NAME).getFiles({
      prefix: "",        // root of the bucket
      delimiter: "/",    // prevents descending into subfolders
    });

    // ✅ Filter only GLB files that are NOT inside week2/
    const glbFiles = files
      .filter(f => f.name.endsWith(".glb") && !f.name.startsWith("week2/"))
      .map(f => ({
        id: f.name,
        part_name: f.name.replace(".glb", ""),
        car_model: "Universal",
        part_type: "Model",
        file_path: `https://storage.googleapis.com/${BUCKET_NAME}/${f.name}`,
        status: "public"
      }));

    console.log(`✅ Found ${glbFiles.length} GLB files in bucket root`);
    res.json({ success: true, submissions: glbFiles });
  } catch (err) {
    console.error("❌ Error fetching GCS files:", err);
    res.status(500).json({ success: false, error: "Failed to list bucket contents" });
  }
});

export default router;

// services/imageToGlbService.js
import fetch from "node-fetch";
import FormData from "form-data";

/**
 * Generate a .glb from an image using Hugging Face (TripoSR).
 * Free with small quotas. Set HF token in .env as HUGGINGFACE_API_KEY
 *
 * Accepts:
 *  - imageBuffer (raw bytes)
 * Returns:
 *  - Buffer (glb) or throws
 */
export async function imageToGlb(imageBuffer) {
  const HF_KEY = process.env.HUGGINGFACE_API_KEY;
  if (!HF_KEY) throw new Error("Missing HUGGINGFACE_API_KEY");

  // TripoSR expects multipart with image file
  const fd = new FormData();
  fd.append("inputs", imageBuffer, { filename: "input.jpg", contentType: "image/jpeg" });

  // You can swap to other open models later (InstantMesh, Instant3D)
  const url = "https://api-inference.huggingface.co/models/TripoSR/triposr";

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${HF_KEY}` },
    body: fd
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`HF ${resp.status}: ${txt.slice(0,300)}`);
  }

  // TripoSR returns binary .glb
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

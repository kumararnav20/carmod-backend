// backend/services/aiPromptService.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Convert natural language into "Level 1" actions for Three.js edits.
 * We return an array of actions; the frontend will apply them to the loaded GLB.
 */
export async function parsePromptToActions(prompt, carContext = {}) {
  // If no API key present, fallback to dumb rules so dev can still test
  if (!process.env.OPENAI_API_KEY) {
    return ruleBasedFallback(prompt);
  }

  const system = `
You are an AI mechanic for a 3D car modding app. 
ONLY return compact JSON. Convert requests into level-1 actions:

TYPES:
- MATERIAL_EDIT { target, parameters:{ color?, roughness?, metalness?, emissive? } }
- TOGGLE_PART   { target, visible:boolean }
- ADD_UNDERGLOW { parameters:{ color, intensity } }
- SET_SUSPENSION{ parameters:{ lift } }  // meters
- SWAP_PRESET   { parameters:{ preset } } // "sport_rims" | "offroad_rims" | "luxury_theme"
- RENAME_PART   { target, parameters:{ to } } // rarely used

Targets are simple aliases: 
body, roof, window, spoiler, grille, light_head, light_tail, mirror,
door_front_left, door_front_right, hood, trunk, diffuser, skirt, 
rim_sport, rim_offroad, underglow.

Color must be #RRGGBB. Only include fields used. Default roughness=0.6, metalness=0.3.
Return strictly: { "actions": [ ... ] }
`;

  const user = `
Prompt: ${prompt}

Known parts: ${JSON.stringify(carContext?.knownParts || [])}
Themes: ${JSON.stringify(carContext?.themes || ["neon_night","luxury","offroad","street_racer"])}
Return strictly JSON only. 
`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || "{}";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.actions)) return parsed.actions;
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed?.actions)) return parsed.actions;
    }
  }
  return [];
}

/** very simple fallback mapper (dev only) */
function ruleBasedFallback(prompt = "") {
  const p = prompt.toLowerCase();
  const actions = [];

  if (p.includes("matte") && p.includes("black")) {
    actions.push({
      type: "MATERIAL_EDIT",
      target: "body",
      parameters: { color: "#111111", roughness: 0.9, metalness: 0.1 },
    });
  }
  if (p.includes("roof")) {
    actions.push({
      type: "MATERIAL_EDIT",
      target: "roof",
      parameters: { color: "#111111", roughness: 0.8, metalness: 0.2 },
    });
  }
  if (p.includes("sport rim") || p.includes("sport wheel")) {
    actions.push({ type: "SWAP_PRESET", parameters: { preset: "sport_rims" } });
  }
  if (p.includes("offroad")) {
    actions.push({ type: "SWAP_PRESET", parameters: { preset: "offroad_rims" } });
  }
  if (p.includes("underglow") || p.includes("neon")) {
    actions.push({
      type: "ADD_UNDERGLOW",
      parameters: { color: "#00ffff", intensity: 2.2 },
    });
  }
  if (p.includes("lift")) {
    actions.push({ type: "SET_SUSPENSION", parameters: { lift: 0.15 } });
  }
  if (p.includes("window") && (p.includes("dark") || p.includes("tint"))) {
    actions.push({
      type: "MATERIAL_EDIT",
      target: "window",
      parameters: { color: "#111111", roughness: 0.2, metalness: 0.0 },
    });
  }
  return actions.length ? actions : [{
    type: "MATERIAL_EDIT",
    target: "body",
    parameters: { color: "#ffcc00", metalness: 0.7, roughness: 0.35 },
  }];
}

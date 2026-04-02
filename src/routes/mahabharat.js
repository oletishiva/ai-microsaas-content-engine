/**
 * src/routes/mahabharat.js
 * ─────────────────────────
 * POST /api/generate-mahabharat  — Claude generates Telugu Mahabharat Short script
 *
 * Modes:
 *   auto   → Claude picks character, category, difficulty (for cron job)
 *   manual → User provides character, context, category, difficulty
 *
 * Returns: { success, script: { title, character, category, difficulty,
 *            hook, story, lesson, cta, visual }, epNumber }
 */

const express   = require("express");
const router    = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const logger    = require("../../utils/logger");

const SYSTEM_PROMPT = `You are a premium Telugu YouTube Shorts scriptwriter specializing in Mahabharat.

Generate a 30-second script with a powerful modern life parallel. Tone: inspirational TED-talk quality in Telugu — NOT folk/village style.

Return ONLY valid JSON (no markdown, no explanation, no code fences):
{
  "title": "Punchy Telugu episode title — max 8 words, creates curiosity",
  "character": "Primary character name in English",
  "incident": "One-line factual Mahabharat incident reference in English",
  "category": "Exactly one of: నాయకత్వం, Family, Career, Dharma, స్త్రీ శక్తి, Strategy, Trust, Self Growth",
  "difficulty": "Easy, Medium, or Deep",
  "hook": "0–5s — first line must stop scroll. Start with a shocking question or statement in Telugu.",
  "story": "5–20s — the exact Mahabharat incident retold in powerful, vivid Telugu. Factually accurate. 60–80 words.",
  "lesson": "20–28s — bridge to modern life in Telugu. How this applies TODAY to career/relationships/decisions. 40–50 words.",
  "cta": "28–30s — strong CTA in Telugu. Max 2 sentences.",
  "visual": "English-only. 2–3 sentences describing key visuals, color mood, camera style for this short."
}

Non-negotiable rules:
1. Factually accurate — only real Mahabharat incidents
2. Premium modern Telugu — confident, urban, powerful
3. Each section must fit spoken aloud in its time window
4. hook must make someone stop scrolling within 2 seconds
5. lesson must feel directly relevant to a 25-year-old Telugu professional`;

const CATEGORIES = ["నాయకత్వం", "Family", "Career", "Dharma", "స్త్రీ శక్తి", "Strategy", "Trust", "Self Growth"];
const CHARACTERS = [
    "Krishna", "Arjuna", "Draupadi", "Bhishma", "Karna",
    "Yudhishthira", "Duryodhana", "Kunti", "Vidura", "Shakuni",
    "Abhimanyu", "Drona", "Dhritarashtra", "Gandhari", "Bheema",
    "Nakula", "Sahadeva", "Subhadra", "Ashwatthama", "Barbarika",
];

router.post("/generate-mahabharat", async (req, res) => {
    const {
        mode           = "auto",
        character,
        incident,
        context,
        hookStyle,
        difficulty,
        category,
        epNumber       = 1,
        usedCharacters = [],
    } = req.body;

    let userMessage;

    if (mode === "auto") {
        const available  = CHARACTERS.filter((c) => !usedCharacters.includes(c));
        const pickCat    = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const pickDiff   = ["Easy", "Medium", "Deep"][Math.floor(Math.random() * 3)];
        const pickChars  = available.slice(0, 6).join(", ") || CHARACTERS.slice(0, 6).join(", ");
        userMessage = `Generate EP ${epNumber} Mahabharat Short.
Category: ${pickCat} | Difficulty: ${pickDiff}
Pick one of these characters (not yet used): ${pickChars}
Make it fresh, surprising, and deeply relatable to modern Telugu youth.`;
    } else {
        userMessage = `Generate EP ${epNumber} Mahabharat Short.
Character/Incident: ${character || "any"}
Modern Context: ${context || "general life lesson"}
Category: ${category || "Dharma"}
Difficulty: ${difficulty || "Medium"}
${hookStyle ? `Hook Style: ${hookStyle}` : ""}
${incident ? `Specific Incident: ${incident}` : ""}`;
    }

    try {
        const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model:      "claude-sonnet-4-6",
            max_tokens: 1200,
            system:     SYSTEM_PROMPT,
            messages:   [{ role: "user", content: userMessage }],
        });

        const raw    = response.content[0].text.trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");
        const script = JSON.parse(raw);

        logger.info("Mahabharat", `EP ${epNumber} generated — ${script.character} (${script.category})`);
        res.json({ success: true, script, epNumber, mode });
    } catch (err) {
        logger.error("Mahabharat", "Script generation failed:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

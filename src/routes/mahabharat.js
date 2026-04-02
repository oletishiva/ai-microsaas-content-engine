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
const path      = require("path");
const fs        = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const logger    = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { uploadToYouTube }         = require("../services/youtubeUploader");

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

// ── POST /api/generate-mahabharat-video ──────────────────────────────────────
// Generates full video from a script: image → composite → voice → FFmpeg → Cloudinary → YouTube
router.post("/generate-mahabharat-video", async (req, res) => {
    const { script, epNumber = 1, postToYouTube = false } = req.body;

    if (!script || !script.title) {
        return res.status(400).json({ success: false, error: "script is required" });
    }

    // Stream progress via SSE — but since we're in a normal POST, just run to completion
    logger.info("Mahabharat", `EP ${epNumber} video generation started — ${script.character}`);

    let videoPath;
    try {
        const { generateMahabharatVideo } = require("../../mahabharat_video_gen");
        videoPath = await generateMahabharatVideo({ script, epNumber, outputDir: OUTPUT_DIR });
        logger.info("Mahabharat", `EP ${epNumber} video rendered: ${path.basename(videoPath)}`);
    } catch (err) {
        logger.error("Mahabharat", "Video generation failed:", err.message);

        // If the image was generated before the failure, upload it as a fallback
        const imagePath = err.imagePath;
        if (imagePath && fs.existsSync(imagePath)) {
            try {
                const { cloudinary } = require("../../config/cloudinary");
                const result = await new Promise((resolve, reject) =>
                    cloudinary.uploader.upload(imagePath, { resource_type: "image", folder: "ai-content-engine" },
                        (e, r) => e ? reject(e) : resolve(r))
                );
                try { fs.unlinkSync(imagePath); } catch (_) {}
                logger.info("Mahabharat", `EP ${epNumber} image uploaded as fallback: ${result.secure_url}`);
                return res.status(500).json({
                    success: false,
                    error: "Video generation failed: " + err.message,
                    imageUrl: result.secure_url,   // frontend can show + let user save it
                });
            } catch (uploadErr) {
                logger.warn("Mahabharat", "Fallback image upload also failed:", uploadErr.message);
                try { fs.unlinkSync(imagePath); } catch (_) {}
            }
        }

        return res.status(500).json({ success: false, error: "Video generation failed: " + err.message });
    }

    // Upload to Cloudinary for streaming URL
    let cloudinaryUrl;
    try {
        cloudinaryUrl = await uploadVideoToCloudinary(videoPath, `mb_ep${String(epNumber).padStart(3, "0")}_${Date.now()}`);
        logger.info("Mahabharat", `EP ${epNumber} uploaded to Cloudinary`);
    } catch (err) {
        logger.error("Mahabharat", "Cloudinary upload failed:", err.message);
        // Don't fail the whole request — return local path info at least
        return res.status(500).json({ success: false, error: "Cloudinary upload failed: " + err.message });
    } finally {
        try { fs.unlinkSync(videoPath); } catch (_) {}
    }

    // Optional YouTube upload
    let youtubeUrl;
    if (postToYouTube) {
        try {
            const mbRefreshToken = process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN;
            const ytTitle       = `${script.title} | EP ${String(epNumber).padStart(2, "0")} | Mahabharat Shorts`;
            const ytDescription = [
                script.hook, script.story, script.lesson, script.cta,
                "", `#Mahabharat #TeluguShorts #${script.character} #${script.category}`,
            ].filter(Boolean).join("\n");
            const ytTags = ["Mahabharat", "Telugu", "TeluguShorts", "shorts", script.character, script.category,
                "మహాభారతం", "inspirational", "motivation", "lifelessons"];

            // Download from Cloudinary → local temp → YouTube
            const tmpPath = path.join(OUTPUT_DIR, `mb_yt_${Date.now()}.mp4`);
            await downloadToFile(cloudinaryUrl, tmpPath);
            youtubeUrl = await uploadToYouTube(tmpPath, ytTitle, ytDescription, {
                tags: ytTags,
                refreshToken: mbRefreshToken,
                categoryId: "27",
                privacyStatus: "public",
            });
            try { fs.unlinkSync(tmpPath); } catch (_) {}
            logger.info("Mahabharat", `EP ${epNumber} posted to YouTube: ${youtubeUrl}`);
        } catch (err) {
            logger.warn("Mahabharat", "YouTube upload failed (video still available on Cloudinary):", err.message);
            // Non-fatal — return cloudinaryUrl, let frontend show the warning
        }
    }

    res.json({
        success: true,
        videoUrl: cloudinaryUrl,
        youtubeUrl: youtubeUrl || null,
        epNumber,
        script,
    });
});

// Helper: stream a URL to a local file (used for Cloudinary → YouTube)
function downloadToFile(url, dest) {
    const https = require("https");
    const http  = require("http");
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302)
                return downloadToFile(res.headers.location, dest).then(resolve).catch(reject);
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode} downloading video`));
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

module.exports = router;

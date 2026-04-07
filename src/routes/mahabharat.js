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
const multer    = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const logger    = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { uploadToYouTube }         = require("../services/youtubeUploader");

// Multer: store uploaded images as temp files in OUTPUT_DIR
const upload = multer({
    dest: OUTPUT_DIR,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per image
    fileFilter: (_, file, cb) => {
        cb(null, /image\/(jpeg|png|webp)/.test(file.mimetype));
    },
});

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

    let videoPath, rawImagePath, compositeImagePath;
    try {
        const { generateMahabharatVideo } = require("../../mahabharat_video_gen");
        const result        = await generateMahabharatVideo({ script, epNumber, outputDir: OUTPUT_DIR });
        videoPath           = result.videoPath;
        rawImagePath        = result.imagePath;
        compositeImagePath  = result.compositeImagePath;
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

    const ts = Date.now();

    // Upload video to Cloudinary
    let cloudinaryUrl;
    try {
        cloudinaryUrl = await uploadVideoToCloudinary(videoPath, `mb_ep${String(epNumber).padStart(3, "0")}_${ts}`);
        logger.info("Mahabharat", `EP ${epNumber} uploaded to Cloudinary`);
    } catch (err) {
        logger.error("Mahabharat", "Cloudinary upload failed:", err.message);
        try { fs.unlinkSync(videoPath); } catch (_) {}
        try { if (rawImagePath) fs.unlinkSync(rawImagePath); } catch (_) {}
        return res.status(500).json({ success: false, error: "Cloudinary upload failed: " + err.message });
    } finally {
        try { fs.unlinkSync(videoPath); } catch (_) {}
    }

    // Upload raw image (for Google Flow) + composited image (with text overlay, for WhatsApp)
    let imageUrl = null;
    let compositeImageUrl = null;
    const { cloudinary } = require("../../config/cloudinary");

    if (rawImagePath && fs.existsSync(rawImagePath)) {
        try {
            const imgResult = await new Promise((resolve, reject) =>
                cloudinary.uploader.upload(rawImagePath, {
                    resource_type: "image",
                    folder: "ai-content-engine/mahabharat-images",
                    public_id: `mb_img_ep${String(epNumber).padStart(3, "0")}_${ts}`,
                }, (e, r) => e ? reject(e) : resolve(r))
            );
            imageUrl = imgResult.secure_url;
            logger.info("Mahabharat", `EP ${epNumber} raw image: ${imageUrl}`);
        } catch (imgErr) {
            logger.warn("Mahabharat", "Raw image upload failed (non-fatal):", imgErr.message);
        } finally {
            try { fs.unlinkSync(rawImagePath); } catch (_) {}
        }
    }

    if (compositeImagePath && fs.existsSync(compositeImagePath)) {
        try {
            const compResult = await new Promise((resolve, reject) =>
                cloudinary.uploader.upload(compositeImagePath, {
                    resource_type: "image",
                    folder: "ai-content-engine/mahabharat-images",
                    public_id: `mb_comp_ep${String(epNumber).padStart(3, "0")}_${ts}`,
                }, (e, r) => e ? reject(e) : resolve(r))
            );
            compositeImageUrl = compResult.secure_url;
            logger.info("Mahabharat", `EP ${epNumber} composite image: ${compositeImageUrl}`);
        } catch (compErr) {
            logger.warn("Mahabharat", "Composite image upload failed (non-fatal):", compErr.message);
        } finally {
            try { fs.unlinkSync(compositeImagePath); } catch (_) {}
        }
    }

    // Optional YouTube upload
    let youtubeUrl;
    if (postToYouTube) {
        try {
            const mbRefreshToken = process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN;
            const hookClean      = (script.hook || script.title || "").replace(/[#@]/g, "").trim();
            const hookShort      = hookClean.length > 60 ? hookClean.slice(0, 57).trimEnd() + "..." : hookClean;
            const ytTitle        = `${hookShort} #shorts`;
            const ytDescription  = [
                `${script.title} | EP ${String(epNumber).padStart(2, "0")} | Mahabharat Shorts`,
                `#Mahabharat #TeluguShorts #${script.character} #${(script.category||"").replace(/\s+/g,"")} #shorts #మహాభారతం #Telugu`,
                "",
                script.hook,
                "",
                script.story,
                "",
                script.lesson,
                "",
                script.cta,
                "",
                "#TeluguMotivation #lifelessons #inspiration #viral #foryou",
            ].filter(s => s !== undefined && s !== null).join("\n");
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
        imageUrl: imageUrl || null,
        compositeImageUrl: compositeImageUrl || null,
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

// ── POST /api/mahabharat-scene-prompts ───────────────────────────────────────
// Returns 4 Claude-generated image prompts for a given script (no image gen)
router.post("/mahabharat-scene-prompts", async (req, res) => {
    const { script } = req.body;
    if (!script || !script.title) {
        return res.status(400).json({ success: false, error: "script is required" });
    }
    try {
        const { buildScenePrompts } = require("../../mahabharat_video_gen");
        const prompts = await buildScenePrompts(script);
        res.json({ success: true, prompts });
    } catch (err) {
        logger.error("Mahabharat", "Scene prompt generation failed:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/build-mahabharat-from-images ────────────────────────────────────
// Accepts 4 uploaded images + script JSON, builds video without any AI image gen
router.post(
    "/build-mahabharat-from-images",
    upload.fields([
        { name: "image0", maxCount: 1 },
        { name: "image1", maxCount: 1 },
        { name: "image2", maxCount: 1 },
        { name: "image3", maxCount: 1 },
    ]),
    async (req, res) => {
        let script, epNumber;
        try {
            script   = JSON.parse(req.body.scriptData);
            epNumber = parseInt(req.body.epNumber || "1", 10);
        } catch (_) {
            return res.status(400).json({ success: false, error: "Invalid scriptData JSON" });
        }

        const files = req.files || {};
        const imagePaths = ["image0","image1","image2","image3"].map(k => files[k]?.[0]?.path);
        if (imagePaths.some(p => !p)) {
            return res.status(400).json({ success: false, error: "All 4 images (image0–image3) are required" });
        }

        logger.info("Mahabharat", `EP ${epNumber} manual-image build started — ${script.character}`);
        let videoPath, rawImagePath;
        try {
            const { generateMahabharatVideoFromImages } = require("../../mahabharat_video_gen");
            const result = await generateMahabharatVideoFromImages({ script, epNumber, outputDir: OUTPUT_DIR, imagePaths });
            videoPath    = result.videoPath;
            rawImagePath = result.imagePath;
        } catch (err) {
            imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
            logger.error("Mahabharat", "Manual build failed:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        } finally {
            // Remove the 3 non-first uploaded originals (first kept as thumbnail)
            imagePaths.slice(1).forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
        }

        const ts = Date.now();

        // Upload video to Cloudinary
        let cloudinaryUrl;
        try {
            cloudinaryUrl = await uploadVideoToCloudinary(videoPath, `mb_ep${String(epNumber).padStart(3,"0")}_${ts}`);
            logger.info("Mahabharat", `EP ${epNumber} manual build uploaded to Cloudinary`);
        } catch (err) {
            logger.error("Mahabharat", "Cloudinary upload failed:", err.message);
            return res.status(500).json({ success: false, error: "Cloudinary upload failed: " + err.message });
        } finally {
            try { fs.unlinkSync(videoPath); } catch (_) {}
        }

        // Upload first image as thumbnail
        let imageUrl = null;
        if (rawImagePath && fs.existsSync(rawImagePath)) {
            try {
                const { cloudinary } = require("../../config/cloudinary");
                const imgResult = await new Promise((resolve, reject) =>
                    cloudinary.uploader.upload(rawImagePath, {
                        resource_type: "image",
                        folder: "ai-content-engine/mahabharat-images",
                        public_id: `mb_img_ep${String(epNumber).padStart(3,"0")}_${ts}`,
                    }, (e, r) => e ? reject(e) : resolve(r))
                );
                imageUrl = imgResult.secure_url;
            } catch (_) {} finally {
                try { fs.unlinkSync(rawImagePath); } catch (_) {}
            }
        }

        // Optional YouTube
        let youtubeUrl;
        if (req.body.postToYouTube === "true" || req.body.postToYouTube === true) {
            try {
                const mbRefreshToken = process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN;
                const ytTitle = `${script.title} | EP ${String(epNumber).padStart(2,"0")} | Mahabharat Shorts`;
                const ytDesc  = [script.hook, script.story, script.lesson, script.cta,
                    "", `#Mahabharat #TeluguShorts #${script.character}`].filter(Boolean).join("\n");
                const ytTags  = ["Mahabharat","Telugu","TeluguShorts","shorts",script.character,script.category,
                    "మహాభారతం","inspirational","motivation","lifelessons"];
                const tmpPath = path.join(OUTPUT_DIR, `mb_yt_${Date.now()}.mp4`);
                await downloadToFile(cloudinaryUrl, tmpPath);
                youtubeUrl = await uploadToYouTube(tmpPath, ytTitle, ytDesc, {
                    tags: ytTags, refreshToken: mbRefreshToken, categoryId: "27", privacyStatus: "public",
                });
                try { fs.unlinkSync(tmpPath); } catch (_) {}
                logger.info("Mahabharat", `EP ${epNumber} manual build posted to YouTube: ${youtubeUrl}`);
            } catch (err) {
                logger.warn("Mahabharat", "YouTube upload failed (non-fatal):", err.message);
            }
        }

        res.json({ success: true, videoUrl: cloudinaryUrl, imageUrl, youtubeUrl: youtubeUrl || null, epNumber, script });
    }
);

// ── POST /api/trigger-mahabharat-cron ────────────────────────────────────────
// Manually fires the scheduled job — same as the 10 AM / 6 PM cron.
// Protected by ADMIN_SECRET query param.
router.post("/trigger-mahabharat-cron", async (req, res) => {
    const secret = req.query.secret || req.body?.secret || "";
    const adminSecret = process.env.ADMIN_SECRET || "";
    if (!adminSecret || secret !== adminSecret) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    res.json({ success: true, message: "Mahabharat cron job triggered — check Railway logs for progress." });
    // Run after responding so the HTTP request doesn't time out
    const { runMahabharatJob } = require("../services/mahabharatScheduler");
    runMahabharatJob().catch(err => logger.error("Mahabharat", "Manual trigger failed:", err.message));
});

module.exports = router;

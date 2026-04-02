/**
 * src/services/mahabharatScheduler.js
 * ─────────────────────────────────────
 * Auto-generates + posts Mahabharat Shorts to YouTube.
 * Runs 2x daily — 10 AM IST and 6 PM IST.
 *
 * Enable with: MAHABHARAT_AUTO_PUBLISH=true in Railway Variables
 * Requires:    MAHABHARAT_YOUTUBE_REFRESH_TOKEN in Railway Variables
 *
 * EP counter persists across restarts in output/.mb_ep_counter
 */

const cron       = require("node-cron");
const path       = require("path");
const fs         = require("fs");
const https      = require("https");
const http       = require("http");
const Anthropic  = require("@anthropic-ai/sdk");
const logger     = require("../../utils/logger");
const { OUTPUT_DIR }              = require("../../config/paths");
const { uploadVideoToCloudinary } = require("./cloudinaryUploader");
const { uploadToYouTube }         = require("./youtubeUploader");

const EP_FILE = path.join(OUTPUT_DIR, ".mb_ep_counter");

// ── EP counter persistence ────────────────────────────────────────────────────
function loadEp() {
    try { return parseInt(fs.readFileSync(EP_FILE, "utf8").trim(), 10) || 1; } catch (_) { return 1; }
}
function saveEp(n) {
    try { fs.writeFileSync(EP_FILE, String(n), "utf8"); } catch (_) {}
}

// ── Characters + Categories ───────────────────────────────────────────────────
const CHARACTERS = [
    "Krishna", "Arjuna", "Draupadi", "Bhishma", "Karna",
    "Yudhishthira", "Duryodhana", "Kunti", "Vidura", "Shakuni",
    "Abhimanyu", "Drona", "Dhritarashtra", "Gandhari", "Bheema",
    "Nakula", "Sahadeva", "Subhadra", "Ashwatthama", "Barbarika",
];
const CATEGORIES = ["నాయకత్వం", "Family", "Career", "Dharma", "స్త్రీ శక్తి", "Strategy", "Trust", "Self Growth"];

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

// ── Helper: download URL → local file ────────────────────────────────────────
function downloadToFile(url, dest) {
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

// ── Main job ─────────────────────────────────────────────────────────────────
async function runMahabharatJob() {
    const epNumber = loadEp();
    logger.info("MahabharatCron", `▶ Starting EP ${epNumber} auto-generation`);

    try {
        // 1. Generate script via Claude
        const pickCat   = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const pickDiff  = ["Easy", "Medium", "Deep"][Math.floor(Math.random() * 3)];
        const pickChars = CHARACTERS.slice(0, 8).join(", ");
        const userMsg   = `Generate EP ${epNumber} Mahabharat Short.
Category: ${pickCat} | Difficulty: ${pickDiff}
Pick one of these characters: ${pickChars}
Make it fresh, surprising, and deeply relatable to modern Telugu youth.`;

        const client   = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model:      "claude-sonnet-4-6",
            max_tokens: 1200,
            system:     SYSTEM_PROMPT,
            messages:   [{ role: "user", content: userMsg }],
        });
        const raw    = response.content[0].text.trim()
            .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const script = JSON.parse(raw);
        logger.info("MahabharatCron", `Script: ${script.character} — ${script.title}`);

        // 2. Generate video
        const { generateMahabharatVideo } = require("../../mahabharat_video_gen");
        const videoPath = await generateMahabharatVideo({ script, epNumber, outputDir: OUTPUT_DIR });
        logger.info("MahabharatCron", `Video rendered: ${path.basename(videoPath)}`);

        // 3. Upload to Cloudinary
        const cloudinaryUrl = await uploadVideoToCloudinary(
            videoPath, `mb_ep${String(epNumber).padStart(3, "0")}_${Date.now()}`
        );
        try { fs.unlinkSync(videoPath); } catch (_) {}
        logger.info("MahabharatCron", `Cloudinary: ${cloudinaryUrl}`);

        // 4. Upload to YouTube
        const refreshToken = process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN;
        if (!refreshToken) {
            logger.warn("MahabharatCron", "MAHABHARAT_YOUTUBE_REFRESH_TOKEN not set — skipping YouTube upload");
            return;
        }

        const ytTitle = `${script.title} | EP ${String(epNumber).padStart(2, "0")} | Mahabharat Shorts`;
        const ytDesc  = [
            script.hook, script.story, script.lesson, script.cta,
            "",
            `#Mahabharat #TeluguShorts #${script.character} #${script.category} #shorts #మహాభారతం #Telugu`,
        ].filter(Boolean).join("\n");
        const ytTags  = ["Mahabharat", "Telugu", "TeluguShorts", "shorts", script.character,
            script.category, "మహాభారతం", "inspirational", "motivation", "lifelessons"];

        const tmpPath = path.join(OUTPUT_DIR, `mb_yt_cron_${Date.now()}.mp4`);
        await downloadToFile(cloudinaryUrl, tmpPath);
        const youtubeUrl = await uploadToYouTube(tmpPath, ytTitle, ytDesc, {
            tags: ytTags,
            refreshToken,
            categoryId: "27",
            privacyStatus: "public",
        });
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        logger.info("MahabharatCron", `✅ EP ${epNumber} posted: ${youtubeUrl}`);

        // 5. Increment EP counter only on full success
        saveEp(epNumber + 1);

    } catch (err) {
        logger.error("MahabharatCron", `EP ${epNumber} failed: ${err.message}`);
    }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startMahabharatScheduler() {
    if (process.env.MAHABHARAT_AUTO_PUBLISH !== "true") {
        logger.info("MahabharatCron", "Disabled. Set MAHABHARAT_AUTO_PUBLISH=true to enable.");
        return;
    }
    if (!process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN) {
        logger.warn("MahabharatCron", "MAHABHARAT_YOUTUBE_REFRESH_TOKEN not set — scheduler will skip YouTube uploads.");
    }

    // 10:00 AM IST and 6:00 PM IST
    // node-cron with timezone:Asia/Kolkata handles DST automatically
    const TZ = "Asia/Kolkata";
    cron.schedule("0 10  * * *", runMahabharatJob, { timezone: TZ });
    cron.schedule("15 15 * * *", runMahabharatJob, { timezone: TZ });
    logger.info("MahabharatCron", `Scheduled: 10:00 AM IST + 3:15 PM IST (${TZ}) [TEMP — revert to 6 PM after test]`);
}

module.exports = { startMahabharatScheduler, runMahabharatJob };

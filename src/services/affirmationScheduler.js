/**
 * src/services/affirmationScheduler.js
 * ─────────────────────────────────────────
 * Auto-generates + posts Telugu morning affirmation Shorts to YouTube.
 * Runs once daily at 6:00 AM IST.
 *
 * Enable with: SAMETA_AUTO_PUBLISH=true  (shares flag with sameta channel)
 * Requires:    SAMETA_YOUTUBE_REFRESH_TOKEN in Railway Variables
 */

const cron   = require("node-cron");
const path   = require("path");
const fs     = require("fs");
const https  = require("https");
const http   = require("http");
const logger = require("../../utils/logger");
const { OUTPUT_DIR }              = require("../../config/paths");
const { uploadVideoToCloudinary } = require("./cloudinaryUploader");
const { uploadToYouTube }         = require("./youtubeUploader");

// ── Main job ──────────────────────────────────────────────────────────────────
async function runAffirmationJob() {
    logger.info("AffirmCron", "▶ Starting morning affirmation generation");

    let videoPath = null;

    try {
        // 1. Generate affirmation video (Telugu, morning type)
        const { generateAffirmationVideo } = require("../../affirmation_video_gen");
        const result = await generateAffirmationVideo({
            language:  "telugu",
            type:      "morning",
            outputDir: OUTPUT_DIR,
        });
        videoPath = result.videoPath;
        const quote = result.quote || "";
        logger.info("AffirmCron", `Video rendered: ${path.basename(videoPath)}`);

        // 2. Upload to Cloudinary
        const cloudinaryUrl = await uploadVideoToCloudinary(videoPath, `affirm_${Date.now()}`);
        try { fs.unlinkSync(videoPath); videoPath = null; } catch (_) {}
        logger.info("AffirmCron", `Cloudinary: ${cloudinaryUrl}`);

        // 3. Upload to YouTube (same channel as samethas)
        const refreshToken =
            process.env.SAMETA_YOUTUBE_REFRESH_TOKEN ||
            process.env.YOUTUBE_REFRESH_TOKEN;

        if (!refreshToken) {
            logger.warn("AffirmCron", "No YouTube refresh token — skipping upload. Set SAMETA_YOUTUBE_REFRESH_TOKEN.");
            return;
        }

        const titleText = quote.length > 70 ? quote.slice(0, 67).trimEnd() + "..." : quote;
        const ytTitle   = `${titleText} #shorts #teluguaffirmations`;
        const ytDesc    = [
            quote,
            "",
            "🌅 శుభోదయం! ప్రతి రోజూ ఈ స్ఫూర్తిదాయకమైన అఫర్మేషన్‌తో మీ దినాన్ని ప్రారంభించండి.",
            "",
            "#teluguaffirmations #teluguMotivation #morningaffirmation #shorts #viral",
            "#తెలుగుస్ఫూర్తి #ఉదయస్ఫూర్తి #TeluguShorts #motivation #positivevibes",
            "#foryou #ytshorts #trending #selfbelief #morningmotivation",
            "",
            "📌 రోజువారీ స్ఫూర్తి కోసం Subscribe చేయండి! 🔔 Bell icon నొక్కండి!",
        ].join("\n");

        // Download Cloudinary video to temp file for YouTube upload
        const tmpPath = path.join(OUTPUT_DIR, `affirm_yt_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(tmpPath);
            const get  = cloudinaryUrl.startsWith("https") ? https.get : http.get;
            get(cloudinaryUrl, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    const get2  = res.headers.location.startsWith("https") ? https.get : http.get;
                    const file2 = fs.createWriteStream(tmpPath);
                    get2(res.headers.location, (res2) => {
                        res2.pipe(file2);
                        file2.on("finish", () => { file2.close(); resolve(); });
                    }).on("error", reject);
                    return;
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
            }).on("error", reject);
        });

        const youtubeUrl = await uploadToYouTube(tmpPath, ytTitle, ytDesc, {
            tags: [
                "teluguaffirmations", "morningaffirmation", "teluguMotivation",
                "తెలుగుస్ఫూర్తి", "ఉదయస్ఫూర్తి", "TeluguShorts", "TeluguWisdom",
                "shorts", "viral", "motivation", "positivevibes", "selfbelief",
                "foryou", "ytshorts", "trending", "morningmotivation",
            ],
            refreshToken,
            categoryId: "27", // Education
            privacyStatus: "public",
        });
        try { fs.unlinkSync(tmpPath); } catch (_) {}

        logger.info("AffirmCron", `✅ Posted: ${youtubeUrl}`);

    } catch (err) {
        logger.error("AffirmCron", `Job failed: ${err.message}`);
        if (videoPath) try { fs.unlinkSync(videoPath); } catch (_) {}
    }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startAffirmationScheduler() {
    if (process.env.SAMETA_AUTO_PUBLISH !== "true") {
        logger.info("AffirmCron", "Disabled. Set SAMETA_AUTO_PUBLISH=true to enable.");
        return;
    }

    const TZ = "Asia/Kolkata";
    cron.schedule("0 6 * * *", runAffirmationJob, { timezone: TZ });
    logger.info("AffirmCron", `Scheduled: 6:00 AM IST (${TZ})`);
}

module.exports = { startAffirmationScheduler, runAffirmationJob };

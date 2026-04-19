/**
 * src/services/sametaScheduler.js
 * ─────────────────────────────────────
 * Auto-generates + posts Telugu Sameta Shorts to YouTube.
 * Runs 2x daily — 7:00 AM IST and 6:00 PM IST.
 *
 * Enable with: SAMETA_AUTO_PUBLISH=true in Railway Variables
 * Requires:    SAMETA_YOUTUBE_REFRESH_TOKEN in Railway Variables
 *              (connect via /auth/youtube?channel=sameta on the main UI)
 */

const cron   = require("node-cron");
const path   = require("path");
const fs     = require("fs");
const logger = require("../../utils/logger");
const { OUTPUT_DIR }              = require("../../config/paths");
const { uploadVideoToCloudinary } = require("./cloudinaryUploader");
const { uploadToYouTube }         = require("./youtubeUploader");

// ── Main job ─────────────────────────────────────────────────────────────────
async function runSametaJob() {
    logger.info("SametaCron", "▶ Starting Sameta auto-generation");

    let videoPath = null;

    try {
        // 1. Pick a fresh motivational sameta via Claude
        const { pickRandomSameta, generateSametaVideo } = require("../../sameta_video_gen");
        const { sameta, meaning } = await pickRandomSameta();
        logger.info("SametaCron", `Sameta: ${sameta}`);

        // 2. Generate video (DALL-E image + text composite + FFmpeg)
        const result = await generateSametaVideo({ sameta, meaning, outputDir: OUTPUT_DIR });
        videoPath = result.videoPath;
        logger.info("SametaCron", `Video rendered: ${path.basename(videoPath)}`);

        // 3. Upload to Cloudinary
        const cloudinaryUrl = await uploadVideoToCloudinary(
            videoPath, `sameta_${Date.now()}`
        );
        try { fs.unlinkSync(videoPath); videoPath = null; } catch (_) {}
        logger.info("SametaCron", `Cloudinary: ${cloudinaryUrl}`);

        // 4. Upload to YouTube
        const refreshToken =
            process.env.SAMETA_YOUTUBE_REFRESH_TOKEN ||
            process.env.YOUTUBE_REFRESH_TOKEN;  // fallback to default token

        if (!refreshToken) {
            logger.warn("SametaCron", "No YouTube refresh token found — skipping upload. Set SAMETA_YOUTUBE_REFRESH_TOKEN.");
            return;
        }

        const sametaShort = sameta.length > 60 ? sameta.slice(0, 57).trimEnd() + "..." : sameta;
        const ytTitle = `${sametaShort} #telugusamethalu #shorts`;
        const ytDesc  = [
            `${sameta}`,
            "",
            `భావం: ${meaning}`,
            "",
            "#sametalu #samethalu #telugusamethalu #samethaluwithmeaning #సామెత #తెలుగుసామెత",
            "#TeluguSameta #TeluguProverbs #TeluguMotivation #TeluguWisdom #TeluguShorts",
            "#shorts #viral #trending #foryou #ytshorts #motivation #lifelessons",
            "",
            "📌 రోజూ స్ఫూర్తిదాయకమైన తెలుగు సామెతల కోసం Subscribe చేయండి! 🔔 Bell icon నొక్కండి!",
        ].join("\n");

        // Download from Cloudinary to temp file for YouTube upload
        const https = require("https");
        const http  = require("http");
        const tmpPath = path.join(OUTPUT_DIR, `sameta_yt_${Date.now()}.mp4`);

        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(tmpPath);
            const get  = cloudinaryUrl.startsWith("https") ? https.get : http.get;
            get(cloudinaryUrl, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    // simple redirect follow
                    const get2 = res.headers.location.startsWith("https") ? https.get : http.get;
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
                "sametalu", "samethalu", "telugusamethalu", "samethaluwithmeaning",
                "సామెత", "తెలుగుసామెత", "TeluguSameta", "TeluguProverbs",
                "Telugu", "TeluguMotivation", "TeluguWisdom", "TeluguShorts",
                "shorts", "viral", "motivation", "ytshorts", "foryou", "trending",
            ],
            refreshToken,
            categoryId: "27", // Education
            privacyStatus: "public",
        });
        try { fs.unlinkSync(tmpPath); } catch (_) {}

        logger.info("SametaCron", `✅ Posted: ${youtubeUrl}`);

    } catch (err) {
        logger.error("SametaCron", `Job failed: ${err.message}`);
        if (videoPath) try { fs.unlinkSync(videoPath); } catch (_) {}
    }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function startSametaScheduler() {
    if (process.env.SAMETA_AUTO_PUBLISH !== "true") {
        logger.info("SametaCron", "Disabled. Set SAMETA_AUTO_PUBLISH=true to enable.");
        return;
    }

    const TZ = "Asia/Kolkata";

    cron.schedule("0 9  * * *", runSametaJob, { timezone: TZ }); // 9:00 AM — morning browse
    cron.schedule("0 20 * * *", runSametaJob, { timezone: TZ }); // 8:00 PM — prime time

    logger.info("SametaCron", `Scheduled: 9 AM + 8 PM IST (${TZ})`);
}

module.exports = { startSametaScheduler, runSametaJob };

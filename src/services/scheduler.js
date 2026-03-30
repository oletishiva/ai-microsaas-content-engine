/**
 * src/services/scheduler.js
 * --------------------------
 * Auto-publishes 6 motivational videos per day to YouTube.
 * Enable with: AUTO_PUBLISH=true in .env or Railway Variables.
 * Optional timezone: SCHEDULE_TIMEZONE=Asia/Kolkata (default: UTC)
 *
 * Schedule (UTC — targets USA, UK, Germany, India simultaneously):
 *   06:00 UTC – Motivation        (6 AM UK, 7 AM DE, 11:30 AM IN, 1 AM USA)
 *   12:00 UTC – Affirmation       (7 AM EST, 12 PM UK, 1 PM DE, 5:30 PM IN)  ← USA morning
 *   15:00 UTC – Success Mindset   (10 AM EST, 3 PM UK, 4 PM DE, 8:30 PM IN)  ← peak all markets
 *   18:00 UTC – Productivity      (1 PM EST, 6 PM UK, 7 PM DE, 11:30 PM IN)  ← peak all markets
 *   21:00 UTC – Life Reflection   (4 PM EST, 9 PM UK, 10 PM DE, 2:30 AM IN)  ← USA/EU evening
 *   23:00 UTC – Night Calm        (6 PM EST, 11 PM UK, midnight DE, 4:30 AM IN) ← USA prime time
 */

const cron = require("node-cron");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const { generateScript } = require("./scriptGenerator");
const { fetchBackgroundMusic } = require("./musicFetcher");
const { generateVideo, validatePipeline } = require("./videoGenerator");
const { uploadToYouTube } = require("./youtubeUploader");
const { uploadVideoToCloudinary } = require("./cloudinaryUploader");
const { mixVoiceWithMusic } = require("../../utils/audioMixer");
const { getImageTextColor } = require("../../utils/imageBrightness");
const { OUTPUT_DIR } = require("../../config/paths");
const { VIDEO_DURATION } = require("../../utils/subtitleHelper");
const apiKeys = require("../../config/apiKeys");
const logger = require("../../utils/logger");

const IMAGES_DIR = path.join(__dirname, "../../images");

/**
 * 6 core daily slots — fits within YouTube's default quota (6 × 1600 = 9600 / 10000 units).
 * 2 bonus slots marked with quota:false — enable only after requesting a quota increase
 * from Google Cloud Console → YouTube Data API v3 → Quotas.
 *
 * Test slot: 10:20 AM IST — fires once daily to verify Railway → YouTube push works.
 * Remove or set enabled:false after confirming it works.
 */
// Audio: silent base + background music (music-only). No TTS for quote videos.
// Set SCHEDULE_TIMEZONE=UTC on Railway for these times to be correct.
const SCHEDULES = [
    // ── Core 6 — UTC times hit USA + UK + Germany + India simultaneously ──
    { label: "Motivation",      topic: "daily morning motivation",            cron: "0 6  * * *", enabled: true  },
    { label: "Affirmation",     topic: "positive daily affirmation",          cron: "0 12 * * *", enabled: true  },
    { label: "Success Mindset", topic: "success mindset winning habits",      cron: "0 15 * * *", enabled: true  },
    { label: "Productivity",    topic: "productivity focus deep work",        cron: "0 18 * * *", enabled: true  },
    { label: "Life Reflection", topic: "life lessons wisdom reflection",      cron: "0 21 * * *", enabled: true  },
    { label: "Night Calm",      topic: "night calm mindfulness peace",        cron: "0 23 * * *", enabled: true  },
    // ── Bonus (needs YouTube quota increase) ──────────────────────────────
    { label: "Evening Wisdom",  topic: "evening wisdom inner peace gratitude",cron: "0 22 * * *", enabled: false },
    { label: "Gratitude Sleep", topic: "gratitude sleep bedtime affirmation", cron: "0 10 * * *", enabled: false },
];

/** Pick 1 random image from /images/ folder for each scheduled Short */
function pickRandomImages() {
    if (!fs.existsSync(IMAGES_DIR)) {
        logger.warn("Scheduler", `Images folder not found: ${IMAGES_DIR}`);
        return [];
    }
    const files = fs.readdirSync(IMAGES_DIR)
        .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .map((f) => path.join(IMAGES_DIR, f));
    if (files.length === 0) {
        logger.warn("Scheduler", "No images found in /images/ folder");
        return [];
    }
    const pick = files[Math.floor(Math.random() * files.length)];
    return [pick];
}

/** Clean up temp files silently */
function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
}

async function runScheduledJob({ label, topic }) {
    logger.info("Scheduler", `▶ Starting: ${label} — "${topic}"`);
    const ts = Date.now();
    let silentPath = null;
    let mixedPath = null;
    let videoPath = null;

    try {
        // 1. Generate script via OpenAI
        const { script, hook, quote, highlight, title } = await generateScript(topic, false);
        logger.info("Scheduler", `Script ready. Hook: "${hook}"`);

        // 2. Pick 1 random image from /images/ — each Short gets a different background.
        const imagePaths = pickRandomImages();
        if (imagePaths.length === 0) {
            logger.warn("Scheduler", `${label}: No images in /images/ folder — skipping.`);
            return;
        }
        logger.info("Scheduler", `Using image: ${path.basename(imagePaths[0])}`);

        // 3. Auto-detect text color from first image brightness
        const textColor = await getImageTextColor(imagePaths[0]);
        logger.info("Scheduler", `Text color: ${textColor}`);

        // 4. Validate FFmpeg pipeline
        await validatePipeline(imagePaths);

        // 5. Silent base audio — motivational quote videos are music + text to read.
        //    TTS is not needed here; background music carries the mood.
        silentPath = path.join(OUTPUT_DIR, `sched_silent_${ts}.mp3`);
        execSync(
            `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${VIDEO_DURATION} -q:a 9 -acodec libmp3lame -y "${silentPath}"`,
            { stdio: "pipe" }
        );
        let audioPath = silentPath;

        // 6. Replace silent base with background music track (full volume, music-only)
        const musicPath = fetchBackgroundMusic();
        if (musicPath && apiKeys.ADD_MUSIC) {
            mixedPath = path.join(OUTPUT_DIR, `sched_mixed_${ts}.mp3`);
            await mixVoiceWithMusic(silentPath, musicPath, mixedPath, { musicOnly: true });
            audioPath = mixedPath;
            logger.info("Scheduler", "Background music added");
        }

        // 7. Render video with red Subscribe button overlay
        const quoteText = quote || script;
        const outputFilename = `sched_${label.toLowerCase().replace(/\s+/g, "_")}_${ts}.mp4`;
        videoPath = await generateVideo(imagePaths, audioPath, quoteText, hook, outputFilename, {
            highlight,
            addSubscribeButton: true,
            textColor,
        });
        logger.info("Scheduler", `Video rendered: ${outputFilename}`);

        // 8. Upload to YouTube
        if (apiKeys.hasYouTubeConfig) {
            const slug = label.toLowerCase().replace(/\s+/g, "");
            // Title = the actual quote sentence (what viral channels use — people search for it).
            // Cascade: OpenAI title → first sentence of quote → hook → topic
            const quoteFirstSentence = (quote || "").split(/[.!?]/)[0]?.trim() || "";
            const rawTitle = (title || quoteFirstSentence || hook || topic).replace(/[#@]/g, "").trim();
            // Append #shorts #motivation to title — YouTube highlights hashtags in title and boosts discovery
            const titleBase = rawTitle.length > 55 ? rawTitle.slice(0, 52).trimEnd() + "..." : rawTitle;
            const ytTitle = `${titleBase} #shorts #motivation`;
            // Description: hashtags FIRST (shown as subtitle under title in search results),
            // then the quote/script, then CTA. YouTube shows the first ~100 chars in search.
            const ytDesc = [
                `#motivation #quotes #${slug} #shorts #motivationalquotes`,
                "",
                quote || script,
                "",
                "Follow for daily wisdom 🔔",
                "",
                `#dailymotivation #selfimprovement #success #mindset #growthmindset #positivevibes #foryou #viral`,
            ].join("\n");
            try {
                const youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic,
                    privacyStatus: "public",
                    categoryId: "27", // Education — better discovery for self-improvement content
                });
                logger.info("Scheduler", `✅ YouTube: ${youtubeUrl}`);
            } catch (ytErr) {
                logger.warn("Scheduler", `YouTube upload failed: ${ytErr.message}`);
            }
        } else {
            logger.info("Scheduler", "YouTube not configured — skipping upload.");
        }

        // 9. Upload to Cloudinary, delete local file
        if (apiKeys.hasCloudinaryConfig) {
            try {
                const cloudUrl = await uploadVideoToCloudinary(videoPath, `sched_${ts}`);
                logger.info("Scheduler", `Cloudinary: ${cloudUrl}`);
                cleanup(videoPath);
                videoPath = null;
            } catch (cErr) {
                logger.warn("Scheduler", `Cloudinary upload failed: ${cErr.message}`);
            }
        }

        logger.info("Scheduler", `✅ ${label} job complete.`);
    } catch (err) {
        logger.error("Scheduler", `${label} job failed: ${err.message}`);
    } finally {
        cleanup(silentPath, mixedPath);
    }
}

/**
 * Start the auto-publish scheduler.
 * Requires AUTO_PUBLISH=true in environment.
 */
function startScheduler() {
    if (process.env.AUTO_PUBLISH !== "true") {
        logger.info("Scheduler", "Auto-publish disabled. Set AUTO_PUBLISH=true to enable 6x daily posting.");
        return;
    }

    const tz = process.env.SCHEDULE_TIMEZONE || "UTC";
    logger.info("Scheduler", `Auto-publish ON — timezone: ${tz}`);

    for (const job of SCHEDULES) {
        if (!job.enabled) {
            logger.info("Scheduler", `  Skipped:   ${job.label.padEnd(16)} → disabled (needs YouTube quota increase)`);
            continue;
        }
        cron.schedule(job.cron, () => runScheduledJob(job), { timezone: tz });
        logger.info("Scheduler", `  Scheduled: ${job.label.padEnd(16)} → ${job.cron.trim()} (${tz})`);
    }
}

module.exports = { startScheduler, runScheduledJob };

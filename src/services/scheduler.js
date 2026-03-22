/**
 * src/services/scheduler.js
 * --------------------------
 * Auto-publishes 6 motivational videos per day to YouTube.
 * Enable with: AUTO_PUBLISH=true in .env or Railway Variables.
 * Optional timezone: SCHEDULE_TIMEZONE=Asia/Kolkata (default: UTC)
 *
 * Schedule (all times in SCHEDULE_TIMEZONE):
 *   06:00 – Motivation
 *   09:00 – Affirmation
 *   12:00 – Success Mindset
 *   15:00 – Productivity
 *   18:00 – Life Reflection
 *   21:00 – Night Calm
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
/**
 * voice — OpenAI TTS voice for each slot. Different voices = variety across the day.
 *   onyx    deep male, authoritative  → Motivation, Success
 *   nova    warm female, energetic    → Affirmation
 *   echo    clear male, focused       → Productivity
 *   fable   expressive, storytelling  → Life Reflection
 *   shimmer soft female, calming      → Night Calm
 */
const SCHEDULES = [
    // ── Core 6 (safe within default YouTube quota: 6 × 1600 = 9600 / 10000 units) ──
    { label: "Motivation",      topic: "daily morning motivation",            cron: "0 6  * * *", voice: "onyx",   enabled: true  },
    { label: "Affirmation",     topic: "positive daily affirmation",          cron: "0 9  * * *", voice: "nova",   enabled: true  },
    { label: "Success Mindset", topic: "success mindset winning habits",      cron: "0 12 * * *", voice: "onyx",   enabled: true  },
    { label: "Productivity",    topic: "productivity focus deep work",        cron: "0 15 * * *", voice: "echo",   enabled: true  },
    { label: "Life Reflection", topic: "life lessons wisdom reflection",      cron: "0 18 * * *", voice: "fable",  enabled: true  },
    { label: "Night Calm",      topic: "night calm mindfulness peace",        cron: "0 21 * * *", voice: "shimmer",enabled: true  },
    // ── Bonus (needs YouTube quota increase) ──────────────────────────────
    { label: "Evening Wisdom",  topic: "evening wisdom inner peace gratitude",cron: "0 22 * * *", voice: "fable",  enabled: false },
    { label: "Gratitude Sleep", topic: "gratitude sleep bedtime affirmation", cron: "0 23 * * *", voice: "shimmer",enabled: false },
    // ── Test slots: verify Railway → YouTube auto-push ───────────────────────
    // Delete all three once the first successful YouTube upload is confirmed.
    { label: "Test 10:35 PM",   topic: "daily morning motivation",            cron: "35 22 * * *", voice: "nova",  enabled: true  },
    { label: "Test 10:40 PM",   topic: "success mindset winning habits",      cron: "40 22 * * *", voice: "nova",  enabled: true  },
    { label: "Test 10:45 PM",   topic: "positive daily affirmation",          cron: "45 22 * * *", voice: "nova",  enabled: true  },
];

/** Pick N random images from /images/ folder */
function pickRandomImages(n = 4) {
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
    const shuffled = [...files].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, files.length));
}

/** Clean up temp files silently */
function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
}

async function runScheduledJob({ label, topic, voice = "nova" }) {
    logger.info("Scheduler", `▶ Starting: ${label} — "${topic}" (voice: ${voice})`);
    const ts = Date.now();
    let voicePath = null;
    let mixedPath = null;
    let videoPath = null;

    try {
        // 1. Generate script via OpenAI
        const { script, hook, quote, highlight, title } = await generateScript(topic, false);
        logger.info("Scheduler", `Script ready. Hook: "${hook}"`);

        // 2. Pick up to 4 images from /images/ — variety keeps videos dynamic.
        //    Add more images to /images/ folder for better visual diversity.
        const imagePaths = pickRandomImages(4);
        if (imagePaths.length === 0) {
            logger.warn("Scheduler", `${label}: No images in /images/ folder — skipping.`);
            return;
        }
        logger.info("Scheduler", `Using ${imagePaths.length} image(s)`);

        // 3. Auto-detect text color from first image brightness
        const textColor = await getImageTextColor(imagePaths[0]);
        logger.info("Scheduler", `Text color: ${textColor}`);

        // 4. Validate FFmpeg pipeline
        await validatePipeline(imagePaths);

        // 5. Silent base audio — motivational quote videos are music + text to read.
        //    TTS is not needed here; background music carries the mood.
        voicePath = path.join(OUTPUT_DIR, `sched_silent_${ts}.mp3`);
        execSync(
            `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${VIDEO_DURATION} -q:a 9 -acodec libmp3lame -y "${voicePath}"`,
            { stdio: "pipe" }
        );
        let audioPath = voicePath;

        // 6. Replace silent base with background music track (full volume, music-only)
        const musicPath = fetchBackgroundMusic();
        if (musicPath && apiKeys.ADD_MUSIC) {
            mixedPath = path.join(OUTPUT_DIR, `sched_mixed_${ts}.mp3`);
            await mixVoiceWithMusic(voicePath, musicPath, mixedPath, { musicOnly: true });
            audioPath = mixedPath;
            logger.info("Scheduler", "Background music added");
        }

        // 7. Render video
        const outputFilename = `sched_${label.toLowerCase().replace(/\s+/g, "_")}_${ts}.mp4`;
        videoPath = await generateVideo(imagePaths, audioPath, quote || script, hook, outputFilename, {
            highlight,
            addSubscribeButton: true,
            textColor,
        });
        logger.info("Scheduler", `Video rendered: ${outputFilename}`);

        // 8. Upload to YouTube
        if (apiKeys.hasYouTubeConfig) {
            const slug = label.toLowerCase().replace(/\s+/g, "");
            // Clean title — no hashtags (YouTube demotes hashtag-stuffed titles).
            const rawTitle = (title || hook || topic).replace(/[#@]/g, "").trim();
            const ytTitle = rawTitle.length > 70 ? rawTitle.slice(0, 67).trimEnd() + "..." : rawTitle;
            // Description: script + CTA + hashtags (top 3 auto-shown above title by YouTube)
            const ytDesc = [
                script,
                "",
                "Follow for daily motivation 🔔",
                "",
                `#quotes #motivation #${slug} #shorts #motivationalquotes #growthmindset`,
                `#dailymotivation #selfimprovement #success #mindset #positivevibes #foryou #viral`,
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
        cleanup(voicePath, mixedPath);
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

module.exports = { startScheduler };

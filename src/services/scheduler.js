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

const SCHEDULES = [
    { label: "Motivation",      topic: "daily morning motivation",       cron: "0 6  * * *" },
    { label: "Affirmation",     topic: "positive daily affirmation",     cron: "0 9  * * *" },
    { label: "Success Mindset", topic: "success mindset winning habits", cron: "0 12 * * *" },
    { label: "Productivity",    topic: "productivity focus deep work",   cron: "0 15 * * *" },
    { label: "Life Reflection", topic: "life lessons wisdom reflection", cron: "0 18 * * *" },
    { label: "Night Calm",      topic: "night calm mindfulness peace",   cron: "0 21 * * *" },
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

async function runScheduledJob({ label, topic }) {
    logger.info("Scheduler", `▶ Starting: ${label} — "${topic}"`);
    const ts = Date.now();
    const silentPath = path.join(OUTPUT_DIR, `sched_silent_${ts}.mp3`);
    let audioPath = silentPath;
    let mixedPath = null;
    let videoPath = null;

    try {
        // 1. Generate script via OpenAI
        const { script, hook, quote, highlight, title } = await generateScript(topic, false);
        logger.info("Scheduler", `Script ready. Hook: "${hook}"`);

        // 2. Pick 1 image from /images/ folder per scheduled video
        const imagePaths = pickRandomImages(1);
        if (imagePaths.length === 0) {
            logger.warn("Scheduler", `${label}: No images available — skipping.`);
            return;
        }

        // 3. Auto-detect text color from first image brightness
        const textColor = await getImageTextColor(imagePaths[0]);
        logger.info("Scheduler", `Image brightness → text color: ${textColor}`);

        // 4. Validate FFmpeg pipeline
        await validatePipeline(imagePaths);

        // 5. Silent audio (ElevenLabs is skipped on Railway)
        execSync(
            `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${VIDEO_DURATION} -q:a 9 -acodec libmp3lame -y "${silentPath}"`,
            { stdio: "pipe" }
        );

        // 6. Mix with background music
        const musicPath = fetchBackgroundMusic();
        if (musicPath && apiKeys.ADD_MUSIC) {
            mixedPath = path.join(OUTPUT_DIR, `sched_mixed_${ts}.mp3`);
            await mixVoiceWithMusic(silentPath, musicPath, mixedPath, { musicOnly: true });
            audioPath = mixedPath;
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
            const ytTitle = `${title || hook} #${slug} #quotes #motivation #shorts`;
            const ytDesc = `${script}\n\n#quotes #motivation #${slug} #shorts #foryou #viral`;
            try {
                const youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic,
                    privacyStatus: "public",
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
        cron.schedule(job.cron, () => runScheduledJob(job), { timezone: tz });
        logger.info("Scheduler", `  Scheduled: ${job.label.padEnd(16)} → ${job.cron.trim()} (${tz})`);
    }
}

module.exports = { startScheduler };

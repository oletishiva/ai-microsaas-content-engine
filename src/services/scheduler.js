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
const { generateScript } = require("./scriptGenerator");
const { uploadToYouTube } = require("./youtubeUploader");
const { uploadVideoToCloudinary } = require("./cloudinaryUploader");
const { OUTPUT_DIR } = require("../../config/paths");
const apiKeys = require("../../config/apiKeys");
const logger = require("../../utils/logger");
const { generateNotebookVideo } = require("../../notebook_video_gen");
const fs = require("fs");

function cleanup(...paths) {
    paths.forEach(p => { if (p) try { fs.unlinkSync(p); } catch (_) {} });
}

const SCHEDULES = [
    // ── Core 6 — UTC times hit USA + UK + Germany + India simultaneously ──
    { label: "Motivation",      topic: "daily morning motivation",            cron: "0 6  * * *", enabled: true  },
    { label: "Success Mindset", topic: "success mindset winning habits",      cron: "0 15 * * *", enabled: true  },
    { label: "Life Reflection", topic: "life lessons wisdom reflection",      cron: "0 21 * * *", enabled: true  },
];


async function runScheduledJob({ label, topic }) {
    logger.info("Scheduler", `▶ Starting: ${label} — "${topic}"`);
    const ts = Date.now();
    let videoPath = null;

    try {
        // 1. Generate quote via Claude/OpenAI
        const { script, hook, quote, title = "" } = await generateScript(topic, false);
        logger.info("Scheduler", `Script ready. Hook: "${hook}"`);

        // 2. Render notebook-style video (same background every video = brand recognition)
        const quoteText = quote || script;
        const outputFilename = `sched_${label.toLowerCase().replace(/\s+/g, "_")}_${ts}.mp4`;
        videoPath = await generateNotebookVideo({
            quote:       quoteText,
            channelName: process.env.MOTIVATIONAL_CHANNEL_NAME || "Motivational quotes",
            outputDir:   OUTPUT_DIR,
            outputName:  outputFilename,
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

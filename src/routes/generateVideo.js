/**
 * src/routes/generateVideo.js
 * -----------------------------
 * POST /api/generate-video – notebook-style motivational video pipeline
 * Optimized for Shorts, Reels, TikTok.
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");

const fs = require("fs");
const path = require("path");
const { generateScript }          = require("../services/scriptGenerator");
const { uploadToYouTube }         = require("../services/youtubeUploader");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { OUTPUT_DIR }              = require("../../config/paths");
const { generateNotebookVideo }   = require("../../notebook_video_gen");

const multer = require("multer");
const upload = multer({ dest: path.join(__dirname, "../../../output/uploads") });

function deriveHookFromScript(script) {
    const s = String(script || "").trim();
    if (!s) return "STOP SCROLLING";
    const firstSentence = s.split(/[.!?]/)[0]?.trim() || s;
    const hook = firstSentence.length > 20
        ? firstSentence.split(/\s+/).slice(0, 3).join(" ") + "..."
        : firstSentence;
    return hook.toUpperCase();
}

/**
 * POST /api/generate-video
 * Body (multipart/form-data):
 *   topic, script, maxWords, title, tags, pushToYouTube, youtubeTitle, youtubeTags
 */
router.post("/generate-video", upload.array("images", 10), async (req, res) => {
    const {
        topic,
        script: scriptInput,
        hook: hookInput,
        maxWords: maxWordsInput,
        title: titleInput,
        tags: tagsInput,
        pushToYouTube: pushToYouTubeInput,
        youtubeTitle: youtubeTitleInput,
        youtubeTags: youtubeTagsInput,
    } = req.body;

    const topicTrimmed      = typeof topic === "string" ? topic.trim() : "";
    const scriptTrimmed     = typeof scriptInput === "string" ? scriptInput.trim() : "";
    const hookTrimmed       = typeof hookInput === "string" ? hookInput.trim() : null;
    const maxWords          = maxWordsInput === "50" || maxWordsInput === 50 ? 50 : 35;
    const customTitle       = typeof titleInput === "string" ? titleInput.trim() : null;
    const customTags        = Array.isArray(tagsInput) ? tagsInput : null;
    const pushToYouTube     = pushToYouTubeInput === true || pushToYouTubeInput === "true";
    const customYouTubeTitle= typeof youtubeTitleInput === "string" ? youtubeTitleInput.trim() : null;
    const customYouTubeTags = typeof youtubeTagsInput === "string" ? youtubeTagsInput.split(",").map(t => t.trim()).filter(Boolean) : null;

    if (!topicTrimmed && !scriptTrimmed) {
        return res.status(400).json({
            success: false,
            error: 'Request body must include a non-empty "topic" or "script" string.',
        });
    }

    const apiKeys = require("../../config/apiKeys");
    const e2eTestMode = apiKeys.E2E_TEST_MODE;

    if (e2eTestMode) {
        logger.info("Pipeline", "E2E test mode: 15 words, 4 images (saves ElevenLabs + Pexels)");
    }

    const searchQuery = topicTrimmed || scriptTrimmed.split(/\s+/).slice(0, 5).join(" ");
    logger.info("Pipeline", `Starting (topic: "${topicTrimmed || "(none)"}", script: ${scriptTrimmed ? "provided" : "will generate"})`);

    let script, hook, quote = null, titleSuggest = null;

    try {
        // STEP 1: Get script (generate or use provided)
        if (scriptTrimmed) {
            logger.info("Pipeline", "STEP 1/3 – Using provided script...");
            script = scriptTrimmed;
            hook = hookTrimmed || deriveHookFromScript(script);
        } else {
            logger.info("Pipeline", `STEP 1/3 – Generating script (maxWords: ${maxWords})...`);
            const generated = await generateScript(topicTrimmed, e2eTestMode, { maxWords });
            script = generated.script;
            hook = hookTrimmed || generated.hook;
            quote = generated.quote || null;
            titleSuggest = generated.title || null;
        }

        // STEP 2: Render notebook-style video
        const timestamp = Date.now();
        const outputFilename = `video_${timestamp}.mp4`;
        logger.info("Pipeline", "STEP 2/3 – Rendering notebook video...");
        const videoPath = await generateNotebookVideo({
            quote:       quote || script,
            channelName: process.env.MOTIVATIONAL_CHANNEL_NAME || "Motivational quotes",
            outputDir:   OUTPUT_DIR,
            outputName:  outputFilename,
        });
        logger.info("Pipeline", "Video generated", { videoPath });

        // STEP 3: Upload to YouTube (optional)
        const TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");
        const fileToken = (() => { try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; } })();
        const sessionToken = req.session?.youtubeRefreshToken || fileToken;
        const canUploadToYouTube = pushToYouTube && (apiKeys.hasYouTubeConfig || (apiKeys.hasYouTubeOAuthConfig && sessionToken));
        let youtubeUrl = null;
        if (canUploadToYouTube) {
            logger.info("Pipeline", "STEP 3/3 – Uploading to YouTube...");
            try {
                const rawSource = titleSuggest
                    || (hook ? hook.replace(/\.\.\.$/,"").trim() : null)
                    || (quote ? quote.split(/[.!?]/).filter(Boolean)[0]?.trim() : null)
                    || (script ? script.split(/[.!?]/).filter(Boolean)[0]?.trim() : null)
                    || searchQuery
                    || "Motivation";
                const punchyTitle = rawSource.split(/\s+/).slice(0, 8).join(" ").replace(/[.!?,]+$/, "").trim() || "Motivation";
                const titleBase = customYouTubeTitle || customTitle || punchyTitle;
                const ytTitle = `${titleBase} #shorts #motivation`;
                const ytDesc = [
                    `#motivation #quotes #shorts #motivationalquotes #quoteoftheday`,
                    "",
                    quote || script || punchyTitle,
                    "",
                    "Follow for daily wisdom 🔔",
                    "",
                    `#dailymotivation #selfimprovement #success #mindset #growthmindset #positivevibes #foryou #viral #deepquotes #lifelessons`,
                ].join("\n");
                youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic: searchQuery,
                    tags: customYouTubeTags || customTags,
                    privacyStatus: "public",
                    refreshToken: sessionToken || undefined,
                });
                logger.info("Pipeline", `YouTube URL: ${youtubeUrl}`);
            } catch (uploadErr) {
                logger.warn("Pipeline", "YouTube upload failed (video still saved):", uploadErr.message);
            }
        } else {
            logger.info("Pipeline", "STEP 3/3 – Skipping YouTube (pushToYouTube is false or credentials not configured)");
        }

        // Upload to Cloudinary and return public video URL
        let videoUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            logger.info("Pipeline", "Uploading to Cloudinary...");
            try {
                videoUrl = await uploadVideoToCloudinary(videoPath, `video_${timestamp}`);
                logger.info("Pipeline", "Upload completed. Public video URL returned.", { videoUrl });
                if (fs.existsSync(videoPath)) {
                    fs.unlinkSync(videoPath);
                    logger.info("Pipeline", "Local video file cleaned up");
                }
            } catch (uploadErr) {
                logger.warn("Pipeline", "Cloudinary upload failed (video still saved locally):", uploadErr.message);
            }
        }

        logger.info("Pipeline", "Complete!");

        const response = {
            success: true,
            topic: topicTrimmed || null,
            script,
            maxWords,
            youtubeUrl,
        };
        if (videoUrl) {
            response.videoUrl = videoUrl;
        } else {
            response.videoPath = videoPath;
        }

        return res.status(200).json(response);
    } catch (err) {
        logger.error("Pipeline", "Pipeline failed", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Pipeline failed",
        });
    }
});

module.exports = router;

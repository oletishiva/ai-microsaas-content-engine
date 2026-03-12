/**
 * src/routes/generateVideo.js
 * -----------------------------
 * POST /api/generate-video – 15-second marketing video pipeline
 * Optimized for Shorts, Reels, TikTok.
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");

const fs = require("fs");
const { generateScript } = require("../services/scriptGenerator");
const { generateVoice } = require("../services/voiceGenerator");
const { fetchImages } = require("../services/imageFetcher");
const { generateVideo, validatePipeline } = require("../services/videoGenerator");
const { uploadToYouTube } = require("../services/youtubeUploader");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");

/**
 * POST /api/generate-video
 * Body: { "topic": "Your product or marketing angle" }
 */
router.post("/generate-video", async (req, res) => {
    const { topic } = req.body;

    if (!topic || typeof topic !== "string" || topic.trim() === "") {
        return res.status(400).json({
            success: false,
            error: 'Request body must include a non-empty "topic" string.',
        });
    }

    const topicTrimmed = topic.trim();
    const apiKeys = require("../../config/apiKeys");
    const e2eTestMode = apiKeys.E2E_TEST_MODE;

    if (e2eTestMode) {
        logger.info("Pipeline", "E2E test mode: 15 words, 4 images (saves ElevenLabs + Pexels)");
    }

    logger.info("Pipeline", `Starting for topic: "${topicTrimmed}"`);

    try {
        // STEP 1: Generate script
        logger.info("Pipeline", "STEP 1/6 – Generating script...");
        const { script, hook } = await generateScript(topicTrimmed, e2eTestMode);

        // STEP 2: Fetch images (before ElevenLabs)
        logger.info("Pipeline", "STEP 2/6 – Fetching images...");
        const imageCount = e2eTestMode ? 4 : 8;
        const imagePaths = await fetchImages(topicTrimmed, imageCount);

        // STEP 3: Validate FFmpeg pipeline BEFORE using ElevenLabs
        logger.info("Pipeline", "STEP 3/6 – Validating FFmpeg pipeline...");
        await validatePipeline(imagePaths);

        // STEP 4: Generate voice (only after FFmpeg validation passes)
        logger.info("Pipeline", "STEP 4/6 – Generating voice...");
        const audioPath = await generateVoice(script);

        // STEP 5: Render 15s video
        const timestamp = Date.now();
        const outputFilename = `video_${timestamp}.mp4`;
        logger.info("Pipeline", "STEP 5/6 – Rendering video...");
        const videoPath = await generateVideo(imagePaths, audioPath, script, hook, outputFilename);
        logger.info("Pipeline", "Video generated", { videoPath });

        // STEP 6: Upload to YouTube (optional, uses local file)
        let youtubeUrl = null;
        if (apiKeys.hasYouTubeConfig) {
            logger.info("Pipeline", "STEP 6/6 – Uploading to YouTube...");
            try {
                youtubeUrl = await uploadToYouTube(
                    videoPath,
                    `${topicTrimmed} #Shorts`,
                    `Auto-generated 15s Short about: ${topicTrimmed}\n\n#Shorts\n\nScript:\n${script}`
                );
                logger.info("Pipeline", `YouTube URL: ${youtubeUrl}`);
            } catch (uploadErr) {
                logger.warn("Pipeline", "YouTube upload failed (video still saved):", uploadErr.message);
            }
        } else {
            logger.info("Pipeline", "STEP 6/6 – Skipping YouTube (credentials not configured)");
        }

        // Upload to Cloudinary and return public video URL
        let videoUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            logger.info("Pipeline", "Uploading to Cloudinary...");
            try {
                videoUrl = await uploadVideoToCloudinary(videoPath, `video_${timestamp}`);
                logger.info("Pipeline", "Upload completed. Public video URL returned.", { videoUrl });
                // Delete local file after successful upload to save disk space
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
            topic,
            script,
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

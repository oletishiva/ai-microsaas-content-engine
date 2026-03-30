/**
 * src/routes/sameta.js
 * ---------------------
 * POST /api/generate-sameta
 *
 * Body (JSON):
 *   { "mode": "random" }                          → Claude picks a random Sameta
 *   { "sameta": "...", "meaning": "..." }          → Custom input
 *
 * Returns: { videoUrl, cloudinaryUrl, sameta, meaning }
 */

const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");
const logger  = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");

const {
    generateSametaVideo,
    pickRandomSameta,
} = require("../../sameta_video_gen");

const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { uploadToYouTube } = require("../services/youtubeUploader");
const apiKeys = require("../../config/apiKeys");

/**
 * POST /api/generate-sameta
 */
router.post("/generate-sameta", async (req, res) => {
    try {
        let { sameta, meaning, mode, pushToYouTube: pushToYouTubeInput } = req.body;
        const pushToYouTube = pushToYouTubeInput === true || pushToYouTubeInput === "true";

        // Random mode — Claude picks from 1000s of Telugu Sametas
        if (mode === "random" || (!sameta && !meaning)) {
            const pick = await pickRandomSameta();
            sameta  = pick.sameta;
            meaning = pick.meaning;
        }

        if (!sameta || !meaning) {
            return res.status(400).json({ error: "Provide sameta + meaning, or mode: random" });
        }

        logger.info("Sameta", `Generating: "${sameta.slice(0, 40)}"`);

        const videoPath = await generateSametaVideo({ sameta, meaning, outputDir: OUTPUT_DIR });
        const ts = Date.now();

        // Upload to Cloudinary
        let videoUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            videoUrl = await uploadVideoToCloudinary(videoPath, `sameta_${ts}`);
            logger.info("Sameta", `Cloudinary: ${videoUrl}`);
        }

        // Upload to YouTube if requested and credentials available
        let youtubeUrl = null;
        const sessionToken = req.session?.youtubeRefreshToken;
        const canUploadToYouTube = pushToYouTube && (apiKeys.hasYouTubeConfig || (apiKeys.hasYouTubeOAuthConfig && sessionToken));
        if (canUploadToYouTube) {
            logger.info("Sameta", "Uploading to YouTube...");
            try {
                const ytTitle = `${sameta} | Telugu Sameta #shorts #telugu`;
                const ytDesc = [
                    `#telugusameta #shorts #telugu #సామెత #motivationalquotes`,
                    "",
                    `సామెత: ${sameta}`,
                    `అర్థం: ${meaning}`,
                    "",
                    "Follow for daily Telugu wisdom 🔔",
                    "",
                    `#teluguquotes #telugumotivation #dailywisdom #viral #foryou`,
                ].join("\n");
                youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic: "Telugu Sameta",
                    privacyStatus: "public",
                    refreshToken: sessionToken || undefined,
                });
                logger.info("Sameta", `YouTube: ${youtubeUrl}`);
            } catch (ytErr) {
                logger.warn("Sameta", "YouTube upload failed:", ytErr.message);
            }
        }

        // Clean up local file after uploads
        if (videoUrl || youtubeUrl) {
            try { fs.unlinkSync(videoPath); } catch (_) {}
        }

        res.json({
            success: true,
            sameta,
            meaning,
            videoUrl: videoUrl || videoPath,
            youtubeUrl,
        });
    } catch (err) {
        logger.error("Sameta", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

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
const apiKeys = require("../../config/apiKeys");

/**
 * POST /api/generate-sameta
 */
router.post("/generate-sameta", async (req, res) => {
    try {
        let { sameta, meaning, mode } = req.body;

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

        let videoUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            const ts = Date.now();
            videoUrl = await uploadVideoToCloudinary(videoPath, `sameta_${ts}`);
            try { fs.unlinkSync(videoPath); } catch (_) {}
            logger.info("Sameta", `Cloudinary: ${videoUrl}`);
        }

        res.json({
            success: true,
            sameta,
            meaning,
            videoUrl: videoUrl || videoPath,
        });
    } catch (err) {
        logger.error("Sameta", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

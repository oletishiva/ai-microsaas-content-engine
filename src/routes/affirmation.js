/**
 * src/routes/affirmation.js
 * --------------------------
 * POST /api/generate-affirmation
 *
 * Body (JSON):
 *   { "language": "english"|"telugu", "type": "morning"|"positive"|"gratitude"|"selflove"|"success",
 *     "custom": "optional custom quote", "pushToYouTube": true|false }
 *
 * Returns: { success, videoUrl, imageUrl, quote, subtext, language, type, youtubeUrl }
 */

const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");
const logger  = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");

const { generateAffirmationVideo, TYPES } = require("../../affirmation_video_gen");
const { uploadVideoToCloudinary }          = require("../services/cloudinaryUploader");
const { uploadToYouTube }                  = require("../services/youtubeUploader");
const apiKeys = require("../../config/apiKeys");

const TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");

function loadTokenFromFile() {
    try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; }
}

/**
 * POST /api/generate-affirmation
 */
router.post("/generate-affirmation", async (req, res) => {
    try {
        let {
            language = "english",
            type     = "positive",
            custom   = "",
            pushToYouTube: pushYTInput,
        } = req.body;

        const pushToYouTube = pushYTInput === true || pushYTInput === "true";

        // Validate type
        const validTypes = Object.keys(TYPES);
        if (!validTypes.includes(type)) type = "positive";

        // Validate language
        if (!["english", "telugu"].includes(language)) language = "english";

        logger.info("Affirmation", `Generating: ${language} / ${type}${custom ? ` — custom "${custom.slice(0, 30)}"` : ""}`);

        const result = await generateAffirmationVideo({
            language,
            type,
            custom,
            outputDir: OUTPUT_DIR,
        });

        const { videoPath, imagePath, quote, subtext } = result;
        const ts = Date.now();

        // Upload video to Cloudinary
        let videoUrl = null;
        let imageUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            videoUrl = await uploadVideoToCloudinary(videoPath, `aff_${language}_${type}_${ts}`);
            logger.info("Affirmation", `Cloudinary video: ${videoUrl}`);

            // Upload background image too
            try {
                const { cloudinary } = require("../../config/cloudinary");
                const imgResult = await new Promise((resolve, reject) =>
                    cloudinary.uploader.upload(imagePath, {
                        resource_type: "image",
                        folder: "ai-content-engine/affirmation-images",
                        public_id: `aff_img_${ts}`,
                    }, (e, r) => e ? reject(e) : resolve(r))
                );
                imageUrl = imgResult.secure_url;
                logger.info("Affirmation", `Cloudinary image: ${imageUrl}`);
            } catch (imgErr) {
                logger.warn("Affirmation", "Image upload failed (non-fatal):", imgErr.message);
            }
        }

        // Clean up local image
        try { fs.unlinkSync(imagePath); } catch (_) {}

        // Upload to YouTube if requested
        let youtubeUrl = null;
        const sessionToken = req.session?.youtubeRefreshToken || loadTokenFromFile() || null;
        const canUpload = pushToYouTube && (sessionToken || apiKeys.hasYouTubeConfig);

        if (canUpload) {
            try {
                const isTelugu  = language === "telugu";
                const typeInfo  = TYPES[type];
                const typeLabel = isTelugu ? typeInfo.te : typeInfo.en;
                const rawTitle  = quote.length > 55 ? quote.slice(0, 52).trimEnd() + "..." : quote;
                const ytTitle   = `${rawTitle} #shorts #affirmation`;
                const slug      = type.toLowerCase();
                const ytDesc    = [
                    isTelugu
                        ? `#affirmation #telugu #తెలుగు #${slug} #shorts #positivevibes #motivation`
                        : `#affirmation #${slug} #shorts #positivevibes #motivation #dailyaffirmation`,
                    "",
                    quote,
                    subtext ? `\n${subtext}` : "",
                    "",
                    isTelugu ? "రోజువారీ స్ఫూర్తి కోసం follow చేయండి 🔔" : "Follow for daily affirmations 🔔",
                    "",
                    isTelugu
                        ? `#teluguaffirmation #telugumotivation #positivevibes #selfcare #viral #foryou`
                        : `#dailyaffirmation #morningaffirmation #selflove #mindset #growthmindset #inspire #viral`,
                ].join("\n");

                youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic: `${typeLabel} affirmation`,
                    privacyStatus: "public",
                    refreshToken: sessionToken || undefined,
                });
                logger.info("Affirmation", `YouTube: ${youtubeUrl}`);
            } catch (ytErr) {
                logger.warn("Affirmation", "YouTube upload failed:", ytErr.message);
            }
        }

        // Clean up local video after uploads
        if (videoUrl || youtubeUrl) {
            try { fs.unlinkSync(videoPath); } catch (_) {}
        }

        res.json({
            success: true,
            quote,
            subtext,
            language,
            type,
            videoUrl: videoUrl || videoPath,
            imageUrl,
            youtubeUrl,
        });
    } catch (err) {
        logger.error("Affirmation", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

/**
 * src/routes/affirmation.js
 * --------------------------
 * POST /api/generate-affirmation
 *
 * Body (JSON):
 *   { "language": "english"|"telugu", "type": "morning"|"positive"|"gratitude"|"selflove"|"success",
 *     "custom": "optional custom quote",
 *     "pushToYouTube": true|false,
 *     "pushToInstagram": true|false,
 *     "pushToFacebook": true|false }
 *
 * Returns: { success, videoUrl, imageUrl, quote, subtext, language, type, youtubeUrl, instagramUrl, facebookUrl }
 */

const express = require("express");
const router  = express.Router();
const path    = require("path");
const fs      = require("fs");
const logger  = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");

const { generateAffirmationVideo, TYPES }               = require("../../affirmation_video_gen");
const { uploadVideoToCloudinary }                       = require("../services/cloudinaryUploader");
const { uploadToYouTube }                               = require("../services/youtubeUploader");
const { publishInstagramReel, publishFacebookVideo }    = require("../services/metaPublisher");
const apiKeys = require("../../config/apiKeys");

const TOKEN_FILE_AFF  = path.join(__dirname, "../../../output/.youtube_affirmation_token");
const META_TOKEN_FILE = path.join(__dirname, "../../../output/.meta_tokens.json");

function loadAffYtToken() {
    try { return fs.readFileSync(TOKEN_FILE_AFF, "utf8").trim() || null; } catch (_) { return null; }
}
function loadMetaTokens(session) {
    if (session?.metaTokens?.userToken) return session.metaTokens;
    try { return JSON.parse(fs.readFileSync(META_TOKEN_FILE, "utf8")); } catch (_) { return null; }
}

/**
 * POST /api/generate-affirmation
 */
router.post("/generate-affirmation", async (req, res) => {
    try {
        let {
            language         = "english",
            type             = "positive",
            custom           = "",
            pushToYouTube:   pushYTInput,
            pushToInstagram: pushIGInput,
            pushToFacebook:  pushFBInput,
        } = req.body;

        const pushToYouTube   = pushYTInput  === true || pushYTInput  === "true";
        const pushToInstagram = pushIGInput  === true || pushIGInput  === "true";
        const pushToFacebook  = pushFBInput  === true || pushFBInput  === "true";

        // Validate type + language
        if (!Object.keys(TYPES).includes(type)) type = "positive";
        if (!["english", "telugu"].includes(language)) language = "english";

        logger.info("Affirmation", `Generating: ${language} / ${type}${custom ? ` — custom "${custom.slice(0, 30)}"` : ""}`);

        const result = await generateAffirmationVideo({ language, type, custom, outputDir: OUTPUT_DIR });
        const { videoPath, imagePath, quote, subtext } = result;
        const ts = Date.now();

        // ── Cloudinary upload ──────────────────────────────────────────────────
        let videoUrl = null;
        let imageUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            videoUrl = await uploadVideoToCloudinary(videoPath, `aff_${language}_${type}_${ts}`);
            logger.info("Affirmation", `Cloudinary video: ${videoUrl}`);

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
        try { fs.unlinkSync(imagePath); } catch (_) {}

        // ── YouTube upload ─────────────────────────────────────────────────────
        let youtubeUrl = null;
        // Affirmation has its OWN YouTube channel token (separate from Sameta / Mahabharat)
        const ytToken   = req.session?.affYtToken || loadAffYtToken() || null;
        const canUploadYT = pushToYouTube && (ytToken || apiKeys.hasYouTubeConfig);

        if (canUploadYT) {
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
                    refreshToken: ytToken || undefined,
                });
                logger.info("Affirmation", `YouTube: ${youtubeUrl}`);
            } catch (ytErr) {
                logger.warn("Affirmation", "YouTube upload failed:", ytErr.message);
            }
        }

        // ── Instagram + Facebook upload ────────────────────────────────────────
        let instagramUrl = null;
        let facebookUrl  = null;

        if ((pushToInstagram || pushToFacebook) && videoUrl) {
            const metaTokens = loadMetaTokens(req.session);
            if (!metaTokens?.userToken) {
                logger.warn("Affirmation", "Meta not connected — skipping Instagram/Facebook upload");
            } else {
                const isTelugu = language === "telugu";
                const caption  = [
                    quote,
                    subtext ? `\n${subtext}` : "",
                    "",
                    isTelugu
                        ? `#affirmation #telugu #తెలుగు #positivevibes #shorts #teluguaffirmation #viral`
                        : `#affirmation #positivevibes #shorts #dailyaffirmation #selflove #mindset #viral`,
                ].join("\n");

                if (pushToInstagram && metaTokens.instagramAccountId) {
                    try {
                        logger.info("Affirmation", "Uploading to Instagram Reels...");
                        instagramUrl = await publishInstagramReel(
                            metaTokens.instagramAccountId,
                            metaTokens.userToken,
                            { videoUrl, caption }
                        );
                        logger.info("Affirmation", `Instagram: ${instagramUrl}`);
                    } catch (igErr) {
                        logger.warn("Affirmation", "Instagram upload failed:", igErr.message);
                    }
                }

                if (pushToFacebook && metaTokens.facebookPageId) {
                    try {
                        logger.info("Affirmation", "Uploading to Facebook...");
                        facebookUrl = await publishFacebookVideo(
                            metaTokens.facebookPageId,
                            metaTokens.facebookPageToken || metaTokens.userToken,
                            { videoUrl, caption, title: quote }
                        );
                        logger.info("Affirmation", `Facebook: ${facebookUrl}`);
                    } catch (fbErr) {
                        logger.warn("Affirmation", "Facebook upload failed:", fbErr.message);
                    }
                }
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
            instagramUrl,
            facebookUrl,
        });
    } catch (err) {
        logger.error("Affirmation", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

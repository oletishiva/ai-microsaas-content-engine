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

const { uploadVideoToCloudinary }                       = require("../services/cloudinaryUploader");
const { uploadToYouTube }                               = require("../services/youtubeUploader");
const { publishInstagramReel, publishFacebookVideo }    = require("../services/metaPublisher");
const apiKeys = require("../../config/apiKeys");

const TOKEN_FILE      = path.join(__dirname, "../../../output/.youtube_user_token");
const META_TOKEN_FILE = path.join(__dirname, "../../../output/.meta_tokens.json");

function loadTokenFromFile() {
    try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; }
}
function loadMetaTokens(session) {
    if (session?.metaTokens?.userToken) return session.metaTokens;
    try { return JSON.parse(fs.readFileSync(META_TOKEN_FILE, "utf8")); } catch (_) { return null; }
}

/**
 * POST /api/generate-sameta
 */
router.post("/generate-sameta", async (req, res) => {
    try {
        let { sameta, meaning, mode,
              pushToYouTube:   pushToYouTubeInput,
              pushToInstagram: pushToInstagramInput,
              pushToFacebook:  pushToFacebookInput,
        } = req.body;
        const pushToYouTube   = pushToYouTubeInput   === true || pushToYouTubeInput   === "true";
        const pushToInstagram = pushToInstagramInput === true || pushToInstagramInput === "true";
        const pushToFacebook  = pushToFacebookInput  === true || pushToFacebookInput  === "true";

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

        const { videoPath, imagePath, imagePrompt } = await generateSametaVideo({ sameta, meaning, outputDir: OUTPUT_DIR });
        const ts = Date.now();

        // Upload video + image to Cloudinary
        let videoUrl = null;
        let imageUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            videoUrl = await uploadVideoToCloudinary(videoPath, `sameta_${ts}`);
            logger.info("Sameta", `Cloudinary video: ${videoUrl}`);
            // Upload raw DALL-E image for Google Flow / Veo animation
            try {
                const { cloudinary } = require("../../config/cloudinary");
                const imgResult = await new Promise((resolve, reject) =>
                    cloudinary.uploader.upload(imagePath, {
                        resource_type: "image",
                        folder: "ai-content-engine/sameta-images",
                        public_id: `sameta_img_${ts}`,
                    }, (e, r) => e ? reject(e) : resolve(r))
                );
                imageUrl = imgResult.secure_url;
                logger.info("Sameta", `Cloudinary image: ${imageUrl}`);
            } catch (imgErr) {
                logger.warn("Sameta", "Image upload failed (non-fatal):", imgErr.message);
            }
        }
        // Clean up local image after upload attempts
        try { fs.unlinkSync(imagePath); } catch (_) {}

        // Upload to YouTube if requested and credentials available
        let youtubeUrl = null;
        const sessionToken = req.session?.youtubeRefreshToken || loadTokenFromFile() || null;

        if (pushToYouTube) {
            if (sessionToken) {
                logger.info("Sameta", "YouTube: using logged-in user's OAuth session token");
            } else if (apiKeys.hasYouTubeConfig) {
                logger.warn("Sameta", "YouTube: no session token found (session may have expired after redeploy) — using env YOUTUBE_REFRESH_TOKEN (default/cron channel). Reconnect YouTube in the UI to use your account.");
            }
        }

        const canUploadToYouTube = pushToYouTube && (sessionToken || apiKeys.hasYouTubeConfig);
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

        // Upload to Instagram Reels + Facebook if requested
        let instagramUrl = null;
        let facebookUrl  = null;
        if ((pushToInstagram || pushToFacebook) && videoUrl) {
            const metaTokens = loadMetaTokens(req.session);
            if (!metaTokens?.userToken) {
                logger.warn("Sameta", "Meta not connected — skipping Instagram/Facebook upload");
            } else {
                const caption = [
                    `${sameta}`,
                    ``,
                    `అర్థం: ${meaning}`,
                    ``,
                    `#telugusameta #shorts #telugu #సామెత #teluguquotes #telugumotivation #dailywisdom #viral #foryou`,
                ].join("\n");

                if (pushToInstagram && metaTokens.instagramAccountId) {
                    try {
                        logger.info("Sameta", "Uploading to Instagram Reels...");
                        instagramUrl = await publishInstagramReel(
                            metaTokens.instagramAccountId,
                            metaTokens.userToken,
                            { videoUrl, caption }
                        );
                        logger.info("Sameta", `Instagram: ${instagramUrl}`);
                    } catch (igErr) {
                        logger.warn("Sameta", "Instagram upload failed:", igErr.message);
                    }
                }

                if (pushToFacebook && metaTokens.facebookPageId) {
                    try {
                        logger.info("Sameta", "Uploading to Facebook...");
                        facebookUrl = await publishFacebookVideo(
                            metaTokens.facebookPageId,
                            metaTokens.facebookPageToken || metaTokens.userToken,
                            { videoUrl, caption, title: sameta }
                        );
                        logger.info("Sameta", `Facebook: ${facebookUrl}`);
                    } catch (fbErr) {
                        logger.warn("Sameta", "Facebook upload failed:", fbErr.message);
                    }
                }
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
            imageUrl,
            imagePrompt: imagePrompt || null,
            usedDefaultChannel: (youtubeUrl && !sessionToken) || undefined,
            youtubeUrl,
            instagramUrl,
            facebookUrl,
        });
    } catch (err) {
        logger.error("Sameta", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/trigger-sameta-cron ────────────────────────────────────────────
// Manually fires the scheduled job — same as the 7 AM / 6 PM cron.
// Protected by ADMIN_SECRET query param.
router.post("/trigger-sameta-cron", async (req, res) => {
    const secret      = req.query.secret || req.body?.secret || "";
    const adminSecret = process.env.ADMIN_SECRET || "";
    if (!adminSecret || secret !== adminSecret) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    res.json({ success: true, message: "Sameta cron job triggered — check logs for progress." });
    const { runSametaJob } = require("../services/sametaScheduler");
    runSametaJob().catch(err => logger.error("Sameta", "Manual trigger failed:", err.message));
});

module.exports = router;

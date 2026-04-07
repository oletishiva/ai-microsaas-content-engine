/**
 * src/routes/studio.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/generate-studio
 *
 * Accepts multipart/form-data:
 *   mode            "guided" | "prompt"
 *   language        "english" | "telugu" | "hindi" | "tamil" | "kannada"
 *   hook            string (guided mode)
 *   quote           string (guided mode — required)
 *   subtext         string (guided mode, optional)
 *   prompt          string (prompt mode — required)
 *   scenes          1–4
 *   style           "cinematic" | "cultural" | "illustrated" | "minimal" | "nature"
 *   duration        15 | 30 | 45 | 60
 *   music           "true" | "false"
 *   pushToYouTube   "true" | "false"
 *   pushToInstagram "true" | "false"
 *   pushToFacebook  "true" | "false"
 *   image_0..image_3  (optional uploaded images — skips AI generation for that scene)
 */

const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const logger  = require("../../utils/logger");
const { OUTPUT_DIR }              = require("../../config/paths");
const { generateStudioVideo }     = require("../../studio_video_gen");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { uploadToYouTube }         = require("../services/youtubeUploader");
const { publishInstagramReel, publishFacebookVideo } = require("../services/metaPublisher");
const apiKeys = require("../../config/apiKeys");

const META_TOKEN_FILE = path.join(__dirname, "../../../output/.meta_tokens.json");

// Multer — temp storage in OUTPUT_DIR, cleaned up after processing
const upload = multer({
    dest: OUTPUT_DIR,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per image
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|jpg|png|webp)$/i.test(file.mimetype)) cb(null, true);
        else cb(new Error("Only JPEG / PNG / WebP images are allowed"));
    },
});

function loadMetaTokens(session) {
    if (session?.metaTokens?.userToken) return session.metaTokens;
    try { return JSON.parse(fs.readFileSync(META_TOKEN_FILE, "utf8")); } catch (_) { return null; }
}

router.post(
    "/generate-studio",
    upload.fields([
        { name: "image_0", maxCount: 1 },
        { name: "image_1", maxCount: 1 },
        { name: "image_2", maxCount: 1 },
        { name: "image_3", maxCount: 1 },
    ]),
    async (req, res) => {
        // Track uploaded temp files so we can clean them up on error
        const tempFiles = (Object.values(req.files || {}).flat()).map(f => f.path);

        try {
            const {
                mode             = "guided",
                language         = "english",
                hook             = "",
                quote            = "",
                subtext          = "",
                prompt           = "",
                scenes:  scenesStr  = "2",
                style            = "cinematic",
                duration: durStr = "30",
                music:   musicStr = "true",
                pushToYouTube:   pushYTInput,
                pushToInstagram: pushIGInput,
                pushToFacebook:  pushFBInput,
            } = req.body;

            const scenes   = Math.min(4, Math.max(1, parseInt(scenesStr, 10) || 2));
            const duration = [15, 30, 45, 60].includes(parseInt(durStr, 10)) ? parseInt(durStr, 10) : 30;
            const music    = musicStr !== "false";
            const pushToYouTube   = pushYTInput   === true || pushYTInput   === "true";
            const pushToInstagram = pushIGInput   === true || pushIGInput   === "true";
            const pushToFacebook  = pushFBInput   === true || pushFBInput   === "true";

            // Validate required fields
            if (mode === "guided" && !quote.trim())
                return res.status(400).json({ error: "quote is required in guided mode" });
            if (mode === "prompt" && !prompt.trim())
                return res.status(400).json({ error: "prompt is required in prompt mode" });

            // Map uploaded files → local image paths per scene index
            const localImages = {};
            for (let i = 0; i < scenes; i++) {
                const uploaded = req.files?.[`image_${i}`]?.[0];
                if (uploaded) localImages[i] = uploaded.path;
            }

            logger.info("Studio", `${mode} | ${language} | ${scenes}sc | ${duration}s | style:${style}`);

            const result = await generateStudioVideo({
                mode, language, hook: hook.trim(), quote: quote.trim(),
                subtext: subtext.trim(), userPrompt: prompt.trim(),
                scenes, style, duration, music, localImages,
                outputDir: OUTPUT_DIR,
            });

            const { videoPath, imagePath, compositeImagePath } = result;
            const ts = Date.now();

            // ── Cloudinary ──────────────────────────────────────────────────
            let videoUrl = null, imageUrl = null, compositeImageUrl = null;
            if (apiKeys.hasCloudinaryConfig) {
                const { cloudinary } = require("../../config/cloudinary");

                videoUrl = await uploadVideoToCloudinary(videoPath, `studio_${language}_${ts}`);
                logger.info("Studio", `Cloudinary video: ${videoUrl}`);

                if (imagePath && fs.existsSync(imagePath)) {
                    try {
                        const r = await new Promise((res, rej) =>
                            cloudinary.uploader.upload(imagePath, {
                                resource_type: "image",
                                folder: "ai-content-engine/studio",
                                public_id: `studio_img_${ts}`,
                            }, (e, r) => e ? rej(e) : res(r))
                        );
                        imageUrl = r.secure_url;
                    } catch (_) {}
                }

                if (compositeImagePath && fs.existsSync(compositeImagePath)) {
                    try {
                        const r = await new Promise((res, rej) =>
                            cloudinary.uploader.upload(compositeImagePath, {
                                resource_type: "image",
                                folder: "ai-content-engine/studio",
                                public_id: `studio_comp_${ts}`,
                            }, (e, r) => e ? rej(e) : res(r))
                        );
                        compositeImageUrl = r.secure_url;
                    } catch (_) {}
                }
            }

            // Cleanup local files after Cloudinary upload
            for (const f of [imagePath, compositeImagePath]) {
                try { if (f) fs.unlinkSync(f); } catch (_) {}
            }
            for (const f of tempFiles) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
            }

            // ── YouTube ─────────────────────────────────────────────────────
            let youtubeUrl = null;
            if (pushToYouTube && (req.session?.youtubeRefreshToken || apiKeys.hasYouTubeConfig)) {
                try {
                    const hookClean = (result.hook || result.quote || "").replace(/[#@]/g, "").trim();
                    const hookShort = hookClean.length > 60 ? hookClean.slice(0, 57).trimEnd() + "..." : hookClean;
                    const ytTitle   = `${hookShort} #shorts`;
                    const ytDesc    = [
                        result.hook,
                        "",
                        result.quote,
                        result.subtext ? `\n${result.subtext}` : "",
                        "",
                        `#shorts #motivation #${language} #viral #foryou`,
                    ].filter(s => s !== null && s !== undefined).join("\n");

                    youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                        privacyStatus: "public",
                        refreshToken: req.session?.youtubeRefreshToken || undefined,
                    });
                    logger.info("Studio", `YouTube: ${youtubeUrl}`);
                } catch (ytErr) {
                    logger.warn("Studio", "YouTube upload failed:", ytErr.message);
                }
            }

            // ── Instagram + Facebook ─────────────────────────────────────────
            let instagramUrl = null, facebookUrl = null;
            if ((pushToInstagram || pushToFacebook) && videoUrl) {
                const metaTokens = loadMetaTokens(req.session);
                if (!metaTokens?.userToken) {
                    logger.warn("Studio", "Meta not connected — skipping IG/FB");
                } else {
                    const caption = [
                        result.hook,
                        result.quote,
                        result.subtext || "",
                        "",
                        `#shorts #motivation #${language} #viral #foryou`,
                    ].filter(Boolean).join("\n");

                    if (pushToInstagram && metaTokens.instagramAccountId) {
                        try {
                            instagramUrl = await publishInstagramReel(
                                metaTokens.instagramAccountId,
                                metaTokens.userToken,
                                { videoUrl, caption }
                            );
                            logger.info("Studio", `Instagram: ${instagramUrl}`);
                        } catch (err) {
                            logger.warn("Studio", "Instagram failed:", err.message);
                        }
                    }
                    if (pushToFacebook && metaTokens.facebookPageId) {
                        try {
                            facebookUrl = await publishFacebookVideo(
                                metaTokens.facebookPageId,
                                metaTokens.facebookPageToken || metaTokens.userToken,
                                { videoUrl, caption, title: result.quote }
                            );
                            logger.info("Studio", `Facebook: ${facebookUrl}`);
                        } catch (err) {
                            logger.warn("Studio", "Facebook failed:", err.message);
                        }
                    }
                }
            }

            if (videoUrl || youtubeUrl) {
                try { fs.unlinkSync(videoPath); } catch (_) {}
            }

            res.json({
                success: true,
                hook:             result.hook,
                quote:            result.quote,
                subtext:          result.subtext,
                language:         result.language,
                videoUrl:         videoUrl || videoPath,
                imageUrl,
                compositeImageUrl,
                youtubeUrl,
                instagramUrl,
                facebookUrl,
            });

        } catch (err) {
            // Always cleanup uploads on error
            for (const f of tempFiles) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
            }
            logger.error("Studio", err.message);
            res.status(500).json({ error: err.message });
        }
    }
);

module.exports = router;

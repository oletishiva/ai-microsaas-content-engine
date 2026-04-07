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

const META_TOKEN_FILE   = path.join(__dirname, "../../../output/.meta_tokens.json");
const STUDIO_TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");

// Load YouTube refresh token: session → file → env var (in that priority order)
function loadYouTubeToken(session) {
    if (session?.youtubeRefreshToken) return session.youtubeRefreshToken;
    try { const t = fs.readFileSync(STUDIO_TOKEN_FILE, "utf8").trim(); if (t) return t; } catch (_) {}
    return process.env.YOUTUBE_REFRESH_TOKEN || null;
}

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
        const tempFiles = (Object.values(req.files || {}).flat()).map(f => f.path);

        // ── SSE helpers ──────────────────────────────────────────────────────
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering on Railway
        res.flushHeaders();

        function emit(eventName, data) {
            res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
        }

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

            if (mode === "guided" && !quote.trim()) {
                emit("error", { error: "quote is required in guided mode" });
                return res.end();
            }
            if (mode === "prompt" && !prompt.trim()) {
                emit("error", { error: "prompt is required in prompt mode" });
                return res.end();
            }

            const localImages = {};
            for (let i = 0; i < scenes; i++) {
                const uploaded = req.files?.[`image_${i}`]?.[0];
                if (uploaded) localImages[i] = uploaded.path;
            }

            logger.info("Studio", `${mode} | ${language} | ${scenes}sc | ${duration}s | style:${style}`);
            emit("progress", { pct: 2, label: "Starting generation..." });

            const result = await generateStudioVideo({
                mode, language, hook: hook.trim(), quote: quote.trim(),
                subtext: subtext.trim(), userPrompt: prompt.trim(),
                scenes, style, duration, music, localImages,
                outputDir: OUTPUT_DIR,
                onProgress: (p) => emit("progress", p),
            });

            const { videoPath, imagePath, compositeImagePath } = result;
            const ts = Date.now();

            // ── Cloudinary ──────────────────────────────────────────────────
            let videoUrl = null, imageUrl = null, compositeImageUrl = null;
            if (apiKeys.hasCloudinaryConfig) {
                const { cloudinary } = require("../../config/cloudinary");

                emit("progress", { pct: 90, label: "Uploading video to Cloudinary..." });
                videoUrl = await uploadVideoToCloudinary(videoPath, `studio_${language}_${ts}`);
                logger.info("Studio", `Cloudinary video: ${videoUrl}`);

                emit("progress", { pct: 94, label: "Uploading images to Cloudinary..." });
                if (imagePath && fs.existsSync(imagePath)) {
                    try {
                        const r = await new Promise((resolve, reject) =>
                            cloudinary.uploader.upload(imagePath, {
                                resource_type: "image",
                                folder: "ai-content-engine/studio",
                                public_id: `studio_img_${ts}`,
                            }, (e, r) => e ? reject(e) : resolve(r))
                        );
                        imageUrl = r.secure_url;
                    } catch (_) {}
                }

                if (compositeImagePath && fs.existsSync(compositeImagePath)) {
                    try {
                        const r = await new Promise((resolve, reject) =>
                            cloudinary.uploader.upload(compositeImagePath, {
                                resource_type: "image",
                                folder: "ai-content-engine/studio",
                                public_id: `studio_comp_${ts}`,
                            }, (e, r) => e ? reject(e) : resolve(r))
                        );
                        compositeImageUrl = r.secure_url;
                    } catch (_) {}
                }
            }

            for (const f of [imagePath, compositeImagePath]) {
                try { if (f) fs.unlinkSync(f); } catch (_) {}
            }
            for (const f of tempFiles) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
            }

            // ── YouTube ─────────────────────────────────────────────────────
            let youtubeUrl = null;
            const ytRefreshToken = loadYouTubeToken(req.session);
            if (pushToYouTube && ytRefreshToken) {
                emit("progress", { pct: 96, label: "Uploading to YouTube..." });
                try {
                    const hookClean = (result.hook || result.quote || "").replace(/[#@]/g, "").trim();
                    const hookShort = hookClean.length > 60 ? hookClean.slice(0, 57).trimEnd() + "..." : hookClean;
                    const ytTitle   = `${hookShort} #shorts`;
                    const ytDesc    = [
                        result.hook, "", result.quote,
                        result.subtext ? `\n${result.subtext}` : "",
                        "", `#shorts #motivation #${language} #viral #foryou`,
                    ].filter(s => s !== null && s !== undefined).join("\n");

                    youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                        privacyStatus: "public",
                        refreshToken: ytRefreshToken,
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
                if (metaTokens?.userToken) {
                    const caption = [
                        result.hook, result.quote, result.subtext || "",
                        "", `#shorts #motivation #${language} #viral #foryou`,
                    ].filter(Boolean).join("\n");

                    if (pushToInstagram && metaTokens.instagramAccountId) {
                        emit("progress", { pct: 97, label: "Publishing to Instagram..." });
                        try {
                            instagramUrl = await publishInstagramReel(
                                metaTokens.instagramAccountId, metaTokens.userToken, { videoUrl, caption }
                            );
                        } catch (err) { logger.warn("Studio", "Instagram failed:", err.message); }
                    }
                    if (pushToFacebook && metaTokens.facebookPageId) {
                        emit("progress", { pct: 98, label: "Publishing to Facebook..." });
                        try {
                            facebookUrl = await publishFacebookVideo(
                                metaTokens.facebookPageId,
                                metaTokens.facebookPageToken || metaTokens.userToken,
                                { videoUrl, caption, title: result.quote }
                            );
                        } catch (err) { logger.warn("Studio", "Facebook failed:", err.message); }
                    }
                }
            }

            if (videoUrl || youtubeUrl) {
                try { fs.unlinkSync(videoPath); } catch (_) {}
            }

            emit("progress", { pct: 100, label: "Done!" });
            emit("done", {
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
            for (const f of tempFiles) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
            }
            logger.error("Studio", err.message);
            emit("error", { error: err.message });
        }

        res.end();
    }
);

module.exports = router;
